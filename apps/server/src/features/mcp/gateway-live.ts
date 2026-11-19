import { Context, type Duration, Effect, Layer, Option, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import { McpPool, type McpScopeContext } from "../mcp-servers/pool.js";
import { VaultCaller } from "./auth.js";
import {
  approvalPrompt,
  descriptorOf,
  fingerprintOf,
  type GatewayTool,
  heldBackNotices,
  McpGateway,
  serversFor,
  type ToolCallApprovals,
  toolCallLevel,
  toolsOf,
  truncateResult,
} from "./gateway.js";
import { askingLevel, pageUrlOf, signInDetail, signInRefusal, typedCredentials } from "./sign-in-guard.js";

/** How long a turn waits for a server's tool list before starting without its tools. */
export const PREPARE_TIMEOUT = "15 seconds" satisfies Duration.Input;
/** How long a tool call may take before the agent is told it timed out. */
export const CALL_TIMEOUT: Duration.Input = "2 minutes";

/** A thread's tools as of its last turn start, and the connections they use. */
interface ThreadSnapshot {
  readonly context: McpScopeContext;
  readonly tools: ReadonlyMap<string, GatewayTool>;
}

const decodeResult = Schema.decodeUnknownEffect(McpSchema.CallToolResult);

/** A failed call as the agent sees it: an error result it can read, never a protocol error. */
const failed = (text: string) => decodeResult({ content: [{ type: "text", text }], isError: true }).pipe(Effect.orDie);

export const McpGatewayLive = Layer.effect(
  McpGateway,
  Effect.gen(function* () {
    const catalog = yield* McpServerCatalog;
    const pool = yield* McpPool;

    let server: McpServer.McpServer["Service"] | undefined;
    /** The thread actors' checks, given when `/mcp` attaches. */
    let approvals: ToolCallApprovals | undefined;
    /** The visibility check, built once `/mcp` attaches; every gateway tool is registered with it. */
    let gate: Context.Context<never> | undefined;
    /** Registered on `/mcp`: name → what it was registered as. */
    const registered = new Map<string, string>();
    /** Prepared before `/mcp` was built; registered when it attaches. */
    const waiting = new Map<string, GatewayTool>();
    const snapshots = new Map<string, ThreadSnapshot>();
    /** Kept after a thread is released, so its next entry never reuses a revision with other tools. */
    const revisions = new Map<string, { readonly fingerprint: string; readonly revision: number }>();
    /** Each thread's browser page, as its last result said: `<thread>|<server>` → URL. */
    const pages = new Map<string, string>();
    const pageKey = (threadId: string, serverId: string) => `${threadId}|${serverId}`;

    const callerSnapshot = Effect.map(Effect.serviceOption(VaultCaller), (caller) =>
      Option.isNone(caller) ? undefined : snapshots.get(caller.value.threadId),
    );

    const call = (name: string, args: unknown) =>
      Effect.gen(function* () {
        const snapshot = yield* callerSnapshot;
        const tool = snapshot?.tools.get(name);
        // Hidden from the thread's list too; only a stale client gets here.
        if (snapshot === undefined || tool === undefined) return yield* failed(`${name} isn't one of this thread's tools now.`);
        if (approvals === undefined) return yield* failed("The app isn't ready to run other servers' tools yet.");
        const page = pages.get(pageKey(snapshot.context.threadId, tool.serverId)) ?? null;
        const typed = tool.browserSignIns ? typedCredentials(tool.tool.name, args, snapshot.context.signIns ?? []) : [];
        if (typed.length > 0) {
          const refusal = signInRefusal(typed, page);
          if (refusal !== null) return yield* failed(refusal);
        }
        const prompt = approvalPrompt(tool, args);
        const approved = yield* approvals
          .approve(
            snapshot.context.threadId,
            typed.length === 0
              ? { level: (autonomy) => toolCallLevel(autonomy, tool), prompt }
              : { level: (autonomy) => askingLevel(toolCallLevel(autonomy, tool)), prompt: { ...prompt, detail: `${signInDetail(typed, page)}\n${prompt.detail}` } },
          )
          .pipe(Effect.result);
        if (approved._tag === "Failure") return yield* failed(approved.failure.message);
        // Another call may have moved the page while you were asked.
        if (typed.length > 0) {
          const refusal = signInRefusal(typed, pages.get(pageKey(snapshot.context.threadId, tool.serverId)) ?? null);
          if (refusal !== null) return yield* failed(refusal);
        }
        const forwarded = pool.callTool(tool.serverId, snapshot.context, tool.tool.name, (args ?? {}) as Record<string, unknown>, { timeout: CALL_TIMEOUT });
        // Stop ends the turn: the call is cancelled with it rather than left running upstream.
        const raced = yield* Effect.raceFirst(Effect.map(Effect.result(forwarded), Option.some), Effect.as(approved.success, Option.none()));
        if (Option.isNone(raced)) return yield* failed(`The turn ended, so the call to ${tool.serverTitle} was cancelled.`);
        const result = raced.value;
        if (result._tag === "Success" && tool.browserSignIns) {
          const now = pageUrlOf(result.success);
          if (now !== null) pages.set(pageKey(snapshot.context.threadId, tool.serverId), now);
        }
        if (result._tag === "Success") {
          return yield* decodeResult(result.success).pipe(
            Effect.flatMap((decoded) => {
              const cut = truncateResult(decoded);
              return cut === decoded ? Effect.succeed(decoded) : decodeResult(cut);
            }),
            Effect.catch(() => failed(`${tool.serverTitle} sent a result the app can't read.`)),
          );
        }
        const error = result.failure;
        switch (error._tag) {
          case "McpServerNotFound":
            return yield* failed(error.reason);
          case "McpToolNotFound":
            return yield* failed(`${tool.serverTitle} no longer has ${tool.tool.name}.`);
          default:
            return yield* failed(error.reason);
        }
      });

    const register = (tool: GatewayTool) =>
      Effect.gen(function* () {
        const descriptor = JSON.stringify(descriptorOf(tool));
        if (registered.get(tool.name) === descriptor) return;
        if (server === undefined || gate === undefined) return void waiting.set(tool.name, tool);
        // A name's description is shared: two projects whose servers list it differently get the latest.
        yield* server.addTool({
          tool: new McpSchema.Tool({ ...descriptorOf(tool) }),
          annotations: Context.empty(),
          services: gate,
          handle: (args) => call(tool.name, args),
        });
        registered.set(tool.name, descriptor);
      });

    return McpGateway.of({
      prepare: (context, selection) =>
        Effect.gen(function* () {
          const { servers } = yield* catalog.current;
          const { chosen, missingForAgent, missingForProject } = serversFor(servers, selection);
          const missing = (who: string) => (id: string) =>
            `${who} lists the MCP server "${id}", which isn't in Settings › MCP servers or whose file doesn't load, so it has none of its tools.`;
          const notices = [...missingForAgent.map(missing("The agent")), ...missingForProject.map(missing("The project"))];
          const lists = yield* Effect.forEach(
            chosen,
            (chosenServer) => pool.tools(chosenServer.id, context).pipe(Effect.timeoutOption(PREPARE_TIMEOUT), Effect.result, Effect.map((tools) => ({ server: chosenServer, tools }))),
            { concurrency: "unbounded" },
          );
          const tools: Array<GatewayTool> = [];
          for (const { server: listed, tools: result } of lists) {
            if (result._tag === "Failure") {
              notices.push(`${listed.title}'s tools aren't available this turn: ${result.failure.reason}`);
            } else if (Option.isNone(result.success)) {
              notices.push(`${listed.title}'s tools aren't available this turn: it didn't answer within ${PREPARE_TIMEOUT}.`);
            } else {
              const { given, heldBack } = toolsOf(listed, result.success.value);
              tools.push(...given);
              notices.push(...heldBackNotices(listed.title, heldBack));
            }
          }
          for (const tool of tools) yield* register(tool);
          snapshots.set(context.threadId, { context, tools: new Map(tools.map((tool) => [tool.name, tool])) });
          const fingerprint = fingerprintOf(tools);
          const previous = revisions.get(context.threadId);
          const revision = previous === undefined ? 0 : previous.fingerprint === fingerprint ? previous.revision : previous.revision + 1;
          revisions.set(context.threadId, { fingerprint, revision });
          return { names: tools.map((tool) => tool.name).sort(), revision, notices };
        }),

      release: (threadId) =>
        Effect.sync(() => {
          snapshots.delete(threadId);
          for (const key of [...pages.keys()]) if (key.startsWith(`${threadId}|`)) pages.delete(key);
        }),

      attach: (mcp, checks) =>
        Effect.gen(function* () {
          approvals = checks;
          const visibility = McpServer.visibility(({ target }) => Effect.map(callerSnapshot, (snapshot) => snapshot?.tools.has(target) === true));
          gate = yield* Layer.build(visibility.layer as Layer.Layer<never>);
          server = mcp;
          const pending = [...waiting.values()];
          waiting.clear();
          for (const tool of pending) yield* register(tool);
        }),
    });
  }),
);
