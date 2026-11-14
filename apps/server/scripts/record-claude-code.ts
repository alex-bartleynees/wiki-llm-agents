/**
 * Records real Claude Code conversations as fixtures for the adapter tests
 * (`tests/fixtures/claude-code/<scenario>.json`). Each scenario runs the real adapter
 * and SDK against a fresh copy of a small vault in a temp folder, on Haiku unless
 * `--model` says otherwise, and records what Claude Code sent and what the adapter's
 * hook and `canUseTool` answered.
 *
 *   npm run record:claude-code -w @wiki-agents/server -- [scenario...] [--model haiku]
 *
 * With no scenario, records them all. Uses your installed `claude` and its login (so
 * it spends a little of your plan or API credit); nothing outside the temp folder is
 * touched, though the sessions are saved in Claude Code's own history.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { HookCallback, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { makeClaudeCodeAdapter } from "../src/features/providers/claude-code/adapter.js";
import { authStatus, binaryVersion } from "../src/features/providers/claude-code/cli.js";
import { type ClaudeCodeSdk, ClaudeCodeSdkLive } from "../src/features/providers/claude-code/sdk.js";
import type { SessionSetup } from "../src/features/providers/port.js";
import { type Fixture, type FixtureStep, HOME, SESSION, VAULT, VAULT_FILES } from "../tests/fixtures/claude-code/fixture.js";

const outDir = fileURLToPath(new URL("../tests/fixtures/claude-code/", import.meta.url));

interface TurnScript {
  readonly prompt: string;
  /** How the recorder answers each request. */
  readonly answer?: RequestAnswer;
  /** Interrupt straight after sending, or after the first text arrives. */
  readonly interrupt?: "after-send" | "after-text";
}

interface Scenario {
  readonly turns: ReadonlyArray<TurnScript>;
  readonly autonomy?: Autonomy;
}

const approve: RequestAnswer = { _tag: "approval", decision: "approve" };
const deny: RequestAnswer = { _tag: "approval", decision: "deny" };

/** The researcher's autonomy: creating notes is allowed, editing asks, commands are denied. */
const RESEARCHER: Autonomy = { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" };

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  simple: { turns: [{ prompt: "Which notes are in this vault? List the file names in one short sentence." }] },
  "multi-turn": {
    turns: [{ prompt: "Remember the word 'kiwi'. Reply with just OK." }, { prompt: "Which word did I ask you to remember? Reply with just the word." }],
  },
  "approval-approved": {
    turns: [{ prompt: "Use the Edit tool to add the line 'Oolong too.' at the end of Notes/Tea.md. Keep the reply to one sentence.", answer: approve }],
  },
  "approval-denied": {
    turns: [
      {
        prompt: "Use the Edit tool to add the line 'Oolong too.' at the end of Notes/Tea.md; don't run commands. If you can't, say so in one sentence.",
        answer: deny,
      },
    ],
  },
  question: {
    turns: [
      {
        prompt:
          "Use the AskUserQuestion tool to ask me which tea I prefer, offering Earl Grey and Sencha. Then reply with one sentence about my answer. Don't edit files.",
        answer: { _tag: "question", text: "Sencha" },
      },
    ],
  },
  "create-and-edit": {
    autonomy: RESEARCHER,
    turns: [
      {
        prompt:
          "Do both, in this order: 1. Use the Write tool to create Notes/Oolong.md containing exactly '# Oolong'. 2. Use the Edit tool to add the line 'See [[Oolong]].' at the end of Notes/Tea.md. Then reply in one sentence.",
        answer: approve,
      },
    ],
  },
  "command-denied": {
    autonomy: RESEARCHER,
    turns: [{ prompt: "Use the Bash tool to run `ls`. If you can't, say so in one sentence and don't try anything else." }],
  },
  "interrupt-after-send": { turns: [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-send" }] },
  "interrupt-mid-stream": { turns: [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-text" }] },
};

/** Messages the adapter reads; `init` cut down to what it uses, so fixtures hold none of your setup. */
const kept = (message: SDKMessage): unknown => {
  switch (message.type) {
    case "system":
      if (message.subtype !== "init") return undefined;
      return {
        type: message.type,
        subtype: message.subtype,
        session_id: message.session_id,
        apiKeySource: message.apiKeySource,
        claude_code_version: message.claude_code_version,
        cwd: message.cwd,
        model: message.model,
        permissionMode: message.permissionMode,
        mcp_servers: message.mcp_servers.filter((server) => server.name.startsWith("wiki-agents-")),
        uuid: message.uuid,
      };
    case "result": {
      const { credential_expires_at: _, ...rest } = message as typeof message & { readonly credential_expires_at?: string };
      return rest;
    }
    case "stream_event":
    case "assistant":
    case "user":
      return message;
    default:
      return undefined;
  }
};

/** Wraps the real SDK, logging each turn's steps into `log.steps`. */
const recordingSdk = (log: { steps: Array<FixtureStep>; sent: () => void }): ClaudeCodeSdk => ({
  sessionExists: ClaudeCodeSdkLive.sessionExists,
  query: ({ prompt, options }) => {
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    const canUseTool = options.canUseTool;
    if (hook === undefined || canUseTool === undefined) throw new Error("the adapter gave no hook or canUseTool");
    const loggedHook: HookCallback = async (input, toolUseId, context) => {
      const output = await hook(input, toolUseId, context);
      if (input.hook_event_name === "PreToolUse") {
        const specific = "hookSpecificOutput" in output && output.hookSpecificOutput?.hookEventName === "PreToolUse" ? output.hookSpecificOutput.permissionDecision : undefined;
        const decision = specific === "allow" || specific === "ask" || specific === "deny" ? specific : "defer";
        log.steps.push({ hook: { toolName: input.tool_name, toolInput: input.tool_input, toolUseId: input.tool_use_id }, decision });
      }
      return output;
    };
    const logged: Options = {
      ...options,
      hooks: { PreToolUse: [{ hooks: [loggedHook] }] },
      canUseTool: async (toolName, toolInput, context) => {
        const result = await canUseTool(toolName, toolInput, context);
        log.steps.push({
          permission: { toolName, toolInput, toolUseId: context.toolUseID, ...(context.blockedPath === undefined ? {} : { blockedPath: context.blockedPath }) },
          behavior: result?.behavior ?? "deny",
        });
        return result;
      },
    };
    const sending = {
      async *[Symbol.asyncIterator]() {
        for await (const message of prompt) {
          yield message;
          log.sent();
        }
      },
    };
    const query = ClaudeCodeSdkLive.query({ prompt: sending, options: logged });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const message of query) {
          const step = kept(message);
          if (step !== undefined) log.steps.push({ message: step });
          yield message;
        }
      },
      interrupt: () => {
        log.steps.push({ interrupt: true });
        return query.interrupt();
      },
      setModel: (model) => query.setModel(model),
      supportedModels: () => query.supportedModels(),
      setMcpServers: (servers) => query.setMcpServers(servers),
      close: () => query.close(),
    };
  },
});

/** Temp paths, the session id and your home folder become placeholders, so fixtures don't depend on where they were made. */
const normalise = (value: unknown, roots: ReadonlyArray<string>, sessionId: string): unknown => {
  let text = JSON.stringify(value);
  for (const root of roots) text = text.replaceAll(root, VAULT);
  return JSON.parse(text.replaceAll(sessionId, SESSION).replaceAll(homedir(), HOME));
};

const record = (name: string, scenario: Scenario, model: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-record-"))),
        (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
      );
      for (const [path, content] of Object.entries(VAULT_FILES)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const binary = process.env.WIKI_AGENTS_CLAUDE ?? "claude";
      const log = { steps: [] as Array<FixtureStep>, sent: () => {} };
      const adapter = yield* makeClaudeCodeAdapter({ sdk: recordingSdk(log), binary, installedVersion: binaryVersion, authStatus });
      const autonomy = scenario.autonomy ?? DEFAULT_AUTONOMY;
      const setup: SessionSetup = { instructions: [], autonomy, projectRoots: null, vaultTools: null };
      const session = yield* adapter.openSession({ threadId: "record", cwd: root, nativeSessionId: null, model, setup });
      const turns = [];
      for (const script of scenario.turns) {
        const turnId = randomUUID();
        const steps: Array<FixtureStep> = [];
        log.steps = steps;
        const sent = yield* Deferred.make<void>();
        log.sent = () => Deferred.doneUnsafe(sent, Effect.void);
        let interrupted = false;
        const stop = Effect.gen(function* () {
          if (interrupted) return;
          interrupted = true;
          yield* Effect.forkChild(session.interrupt(turnId));
        });
        const fiber = yield* session.startTurn({ turnId, text: script.prompt, images: [], setup }).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              // Approvals the script doesn't expect are denied, so a recording never waits.
              if (event._tag === "request.opened") yield* Effect.forkChild(session.answerRequest(event.requestId, script.answer ?? deny));
              if (event._tag === "message.delta" && script.interrupt === "after-text") yield* stop;
              if (event._tag === "turn.finished") yield* Effect.log(`${name}: turn ${event.outcome}${event.reason === null ? "" : ` (${event.reason})`}`);
            }),
          ),
          Effect.forkChild,
        );
        if (script.interrupt === "after-send") {
          yield* Deferred.await(sent);
          yield* stop;
        }
        yield* Fiber.join(fiber);
        turns.push({ prompt: script.prompt, steps });
      }
      const fixture: Fixture = {
        scenario: name,
        claudeCodeVersion: yield* binaryVersion(binary),
        model,
        autonomy,
        turns: turns.map((turn) => normalise(turn, [realpathSync(root), root], session.nativeSessionId ?? "")) as Fixture["turns"],
      };
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
      yield* Effect.log(`recorded ${name}: ${turns.map((turn) => turn.steps.length).join(" + ")} steps`);
    }),
  );

const { values, positionals } = parseArgs({ options: { model: { type: "string" } }, allowPositionals: true });
const names = positionals.length > 0 ? positionals : Object.keys(SCENARIOS);
const unknown = names.filter((name) => SCENARIOS[name] === undefined);
if (unknown.length > 0) throw new Error(`unknown scenario: ${unknown.join(", ")} (have ${Object.keys(SCENARIOS).join(", ")})`);

await Effect.runPromise(Effect.forEach(names, (name) => record(name, SCENARIOS[name]!, values.model ?? "haiku"), { discard: true }));
