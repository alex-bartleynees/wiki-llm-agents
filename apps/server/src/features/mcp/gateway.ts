import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { gatewayToolName, gatewayToolProblem, type McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
import type { RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Context, type Effect, type Scope } from "effect";
import type { McpSchema, McpServer } from "effect/ai";
import type { McpScopeContext } from "../mcp-servers/pool.js";

/**
 * The MCP gateway: tools of the servers in `mcp/*.yaml` (the coffee journal, GitHub...),
 * given to threads on their own `/mcp` entry as `<server>__<tool>` and called through
 * the connection pool. Providers see one entry per thread whatever the servers, and
 * never a secret.
 *
 * Each upstream tool is registered on `/mcp` once, by name, behind a visibility check:
 * a thread sees the tools of its last `prepare`, and nothing else.
 */
export interface McpGatewayService {
  /**
   * Works out the thread's tools for its next turn: the servers given to every thread
   * plus `agentServers`, each server's tools whose names fit. A server that is down or
   * slow leaves out only its own tools. Says what was left out, and why. Whether a
   * call runs, asks or is refused is decided when it is made (`toolCallLevel`).
   */
  readonly prepare: (context: McpScopeContext, agentServers: ReadonlyArray<string>) => Effect.Effect<ThreadTools>;
  /** Hides every gateway tool from the thread (its actor closed). */
  readonly release: (threadId: string) => Effect.Effect<void>;
  /**
   * Called by `/mcp` once it is built: tools are registered on `server` from then on,
   * including those prepared before, and every call is checked with `approvals` (the
   * thread actors, which can't be a dependency of this layer: they use it).
   */
  readonly attach: (server: McpServer.McpServer["Service"], approvals: ToolCallApprovals) => Effect.Effect<void, never, Scope.Scope>;
}

export class McpGateway extends Context.Service<McpGateway, McpGatewayService>()("McpGateway") {}

export interface ThreadTools {
  /** `<server>__<tool>` names, sorted. */
  readonly names: ReadonlyArray<string>;
  /**
   * Starts at 0 and goes up by one each time the thread's set of tools changes, so
   * providers can register the entry again: they don't list tools again otherwise.
   */
  readonly revision: number;
  /** For the user: servers down or missing, tools held back. */
  readonly notices: ReadonlyArray<string>;
}

/** An upstream tool as threads get it. */
export interface GatewayTool {
  /** `<server>__<tool>`. */
  readonly name: string;
  readonly serverId: string;
  readonly serverTitle: string;
  /** The server's `access` when the tool list was read: overrides the agent's autonomy for its tools. */
  readonly access: AutonomyLevel | null;
  /** The server is a browser given the project's sign-ins: typing a credential's name is checked (`sign-in-guard.ts`). */
  readonly browserSignIns: boolean;
  /** The server's own description of it, with its own name. */
  readonly tool: McpSchema.Tool;
}

/**
 * Before a gateway tool runs: the thread's actor checks the agent's autonomy (as it is
 * now, not when the turn started) and asks you when it says `ask`.
 */
export interface ToolCallApprovals {
  /**
   * Succeeds once the call may run, with an effect that completes when the turn it
   * runs in ends (Stop, say), so the call is cancelled with it. Fails with the reason
   * the agent is told when it may not.
   */
  readonly approve: (threadId: string, call: ToolCallCheck) => Effect.Effect<Effect.Effect<void>, ToolCallRefusal>;
}

/** What the actor needs to decide on one call. */
export interface ToolCallCheck {
  /** The level the call needs, from the agent's effective autonomy. */
  readonly level: (autonomy: Autonomy) => AutonomyLevel;
  /** What you are asked to approve: server, tool and arguments. */
  readonly prompt: Extract<RequestPrompt, { readonly _tag: "approval" }>;
}

/** Why a call didn't run, as the agent is told it. */
export interface ToolCallRefusal {
  readonly message: string;
}

/**
 * The level a call needs: a tool the server marks read-only follows `read`, any other
 * `tools`; a server's `access` replaces the agent's level for all its tools.
 */
export const toolCallLevel = (autonomy: Autonomy, tool: Pick<GatewayTool, "access" | "tool">): AutonomyLevel =>
  tool.access ?? (tool.tool.annotations?.readOnlyHint === true ? autonomy.read : autonomy.tools);

/** Longest argument text shown in an approval. */
export const MAX_APPROVAL_ARGUMENTS = 4_000;

/** The approval card for a call: `GitHub: create_issue`, then the arguments as JSON. */
export const approvalPrompt = (tool: Pick<GatewayTool, "serverId" | "serverTitle" | "tool">, args: unknown): ToolCallCheck["prompt"] => {
  const json = JSON.stringify(args ?? {}, null, 2) ?? "{}";
  const shown = json.length > MAX_APPROVAL_ARGUMENTS ? `${json.slice(0, MAX_APPROVAL_ARGUMENTS)}\n… (${json.length - MAX_APPROVAL_ARGUMENTS} more characters not shown)` : json;
  // MCP's default for a tool that isn't read-only is "may be destructive".
  const annotations = tool.tool.annotations;
  const hints = annotations?.readOnlyHint !== true && annotations?.destructiveHint !== false ? ["The server doesn't say this tool only adds things: it may change or delete them."] : [];
  return {
    _tag: "approval",
    title: `${tool.serverTitle}: ${tool.tool.title ?? tool.tool.annotations?.title ?? tool.tool.name}`,
    detail: [`MCP server ${tool.serverId}, tool ${tool.tool.name}.`, ...hints, "Arguments:", shown].join("\n"),
  };
};

/** Longest text a call's result gives the agent, per text block. */
export const MAX_RESULT_TEXT = 100_000;

/** Cuts long text blocks, saying so, so one huge result can't fill the agent's context. */
export const truncateResult = <R extends { readonly content: ReadonlyArray<{ readonly type: string; readonly text?: unknown }> }>(result: R): R => {
  const long = (block: R["content"][number]) => block.type === "text" && typeof block.text === "string" && block.text.length > MAX_RESULT_TEXT;
  if (!result.content.some(long)) return result;
  const content = result.content.map((block) => {
    if (!long(block)) return block;
    const text = block.text as string;
    return { ...block, text: `${text.slice(0, MAX_RESULT_TEXT)}\n… [cut by wiki-agents: ${text.length - MAX_RESULT_TEXT} more characters of ${text.length}]` };
  });
  return { ...result, content };
};

/** The servers a thread gets: those for every thread and those its agent lists; and the listed ones that don't exist. */
export const serversFor = (servers: ReadonlyArray<McpServerSummary>, agentServers: ReadonlyArray<string>) => ({
  chosen: servers.filter((server) => server.default || agentServers.includes(server.id)),
  missing: agentServers.filter((id) => !servers.some((server) => server.id === id)),
});

/** A server's tools split into those threads get and those held back, with why. */
export const toolsOf = (server: Pick<McpServerSummary, "id" | "title" | "access" | "browserSignIns">, tools: ReadonlyArray<McpSchema.Tool>) => {
  const given: Array<GatewayTool> = [];
  const heldBack: Array<{ readonly name: string; readonly problem: string }> = [];
  for (const tool of tools) {
    const problem = gatewayToolProblem(server.id, { name: tool.name });
    if (problem === null) given.push({ name: gatewayToolName(server.id, tool.name), serverId: server.id, serverTitle: server.title, access: server.access, browserSignIns: server.browserSignIns, tool });
    else heldBack.push({ name: tool.name, problem });
  }
  return { given, heldBack };
};

/** One notice per reason: `GitHub: create_issue and merge_pr aren't given to agents. They may change things…`. */
export const heldBackNotices = (title: string, heldBack: ReadonlyArray<{ readonly name: string; readonly problem: string }>): ReadonlyArray<string> => {
  const byProblem = new Map<string, Array<string>>();
  for (const { name, problem } of heldBack) byProblem.set(problem, [...(byProblem.get(problem) ?? []), name]);
  return [...byProblem].map(([problem, names]) => `${title}: ${listed(names)} ${names.length === 1 ? "isn't" : "aren't"} given to agents. ${problem}`);
};

const listed = (names: ReadonlyArray<string>) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What agents are shown for a tool; a change to any of it means registering the entry again. */
export const descriptorOf = (tool: GatewayTool) => ({
  name: tool.name,
  title: tool.tool.title ?? tool.tool.annotations?.title,
  description: `${tool.serverTitle} (MCP server ${tool.serverId}): ${tool.tool.description ?? tool.tool.name}`,
  inputSchema: tool.tool.inputSchema,
  outputSchema: tool.tool.outputSchema,
  annotations: tool.tool.annotations,
});

/** Identifies a set of tools as agents see them. */
export const fingerprintOf = (tools: ReadonlyArray<GatewayTool>) => JSON.stringify([...tools].sort((a, b) => a.name.localeCompare(b.name)).map(descriptorOf));
