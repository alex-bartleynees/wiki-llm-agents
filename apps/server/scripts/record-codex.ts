/**
 * Records real Codex conversations as fixtures for the adapter tests
 * (`tests/fixtures/codex/<scenario>.json`). Each scenario runs the real adapter and
 * `codex app-server` against a fresh copy of a small vault in a temp folder, on
 * gpt-5.6-luna unless `--model` says otherwise, and records what Codex sent and what
 * the adapter answered.
 *
 *   npm run record:codex -w @wiki-agents/server -- [scenario...] [--model gpt-5.6-luna]
 *
 * With no scenario, records them all. Uses your installed `codex` and its login (so
 * it spends a little of your plan or API credit); nothing outside the temp folder is
 * touched, though the threads are saved in Codex's own history.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { Deferred, Effect, Fiber, Stream } from "effect";
import { makeCodexAdapter } from "../src/features/providers/codex/adapter.js";
import { type CodexLauncher, CodexLauncherLive } from "../src/features/providers/codex/app-server.js";
import { authStatus, binaryVersion } from "../src/features/providers/codex/cli.js";
import { VAULT_SERVER } from "../src/features/providers/codex/events.js";
import type { JsonRpcMessage } from "../src/features/providers/codex/protocol.js";
import type { SessionSetup } from "../src/features/providers/port.js";
import { type Fixture, type FixtureStep, HOME, THREAD, VAULT, VAULT_FILES } from "../tests/fixtures/codex/fixture.js";

const outDir = fileURLToPath(new URL("../tests/fixtures/codex/", import.meta.url));

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
    turns: [{ prompt: "Use apply_patch to add the line 'Oolong too.' at the end of Notes/Tea.md. Keep the reply to one sentence.", answer: approve }],
  },
  "approval-denied": {
    turns: [
      {
        prompt: "Use apply_patch to add the line 'Oolong too.' at the end of Notes/Tea.md; don't run commands. If you can't, say so in one sentence.",
        answer: deny,
      },
    ],
  },
  "command-approved": {
    turns: [{ prompt: "Run `mkdir Drafts` in the shell, then reply in one sentence.", answer: approve }],
  },
  "create-and-edit": {
    autonomy: RESEARCHER,
    turns: [
      {
        prompt:
          "Make two separate apply_patch calls, in this order: 1. create Notes/Oolong.md containing exactly '# Oolong'. 2. add the line 'See [[Oolong]].' at the end of Notes/Tea.md. Then reply in one sentence.",
        answer: approve,
      },
    ],
  },
  "command-denied": {
    autonomy: RESEARCHER,
    turns: [{ prompt: "Run `mkdir Drafts` in the shell, requesting escalated permissions since the sandbox is read-only. If it is refused, say so in one sentence and don't try anything else." }],
  },
  question: {
    turns: [
      {
        prompt: "Use the request_user_input tool to ask me which tea I prefer, offering Earl Grey and Sencha. Then reply with one sentence about my answer. Don't edit files.",
        answer: { _tag: "question", text: "Sencha" },
      },
    ],
  },
  "interrupt-after-send": { turns: [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-send" }] },
  "interrupt-mid-stream": { turns: [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-text" }] },
};

/** Notifications the adapter reads; the rest (rate limits, moderation, status) would only make fixtures bigger. */
const KEPT = new Set([
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "mcpServer/startupStatus/updated",
  "serverRequest/resolved",
  "error",
]);

/** Item types the adapter shows. */
const SHOWN_ITEMS = new Set(["agentMessage", "commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageView", "collabAgentToolCall"]);

const kept = (message: JsonRpcMessage): boolean => {
  if (message.method === undefined) return false;
  if (message.id !== undefined) return true;
  if (!KEPT.has(message.method)) return false;
  const params = message.params as { readonly item?: { readonly type: string }; readonly name?: string };
  if (params.item !== undefined && !SHOWN_ITEMS.has(params.item.type)) return false;
  if (message.method === "mcpServer/startupStatus/updated" && params.name !== VAULT_SERVER) return false;
  return true;
};


/** Output of a command that read files outside the vault (your skills, say) isn't kept in fixtures. */
const OUTSIDE = "[output of a command that read outside the vault, left out of the fixture]";

const redacted = (message: JsonRpcMessage, root: string): JsonRpcMessage => {
  const item = (message.params as { readonly item?: { readonly type: string; readonly command?: string; readonly commandActions?: ReadonlyArray<{ readonly path?: string | null }> } } | undefined)?.item;
  if (item?.type !== "commandExecution") return message;
  const outside =
    (item.command ?? "").includes(homedir()) ||
    (item.commandActions ?? []).some((action) => typeof action.path === "string" && action.path.startsWith("/") && !action.path.startsWith(root));
  if (!outside) return message;
  return { ...message, params: { ...(message.params as object), item: { ...item, aggregatedOutput: OUTSIDE } } };
};

/** Wraps the real launcher, logging each turn's steps into `log.steps`. */
const recordingLauncher = (log: { steps: Array<FixtureStep>; sent: () => void }, root: string): CodexLauncher => ({
  launch: (options) => {
    const process = CodexLauncherLive.launch(options);
    return {
      send: (message) => {
        if (message.method === "turn/start") log.sent();
        if (message.method === "turn/interrupt") log.steps.push({ interrupt: true });
        if (message.method === undefined && message.id !== undefined) log.steps.push({ response: { id: message.id, result: message.result ?? message.error } });
        process.send(message);
      },
      listen: (handlers) =>
        process.listen({
          message: (message) => {
            if (kept(message)) log.steps.push({ message: redacted(message, root) });
            handlers.message(message);
          },
          exit: handlers.exit,
        }),
      kill: process.kill,
    };
  },
});

/** Temp paths, the thread id and your home folder become placeholders, so fixtures don't depend on where they were made. */
const normalise = (value: unknown, roots: ReadonlyArray<string>, threadId: string): unknown => {
  let text = JSON.stringify(value);
  for (const root of roots) text = text.replaceAll(root, VAULT);
  return JSON.parse(text.replaceAll(threadId, THREAD).replaceAll(homedir(), HOME));
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
      const binary = process.env.WIKI_AGENTS_CODEX ?? "codex";
      const log = { steps: [] as Array<FixtureStep>, sent: () => {} };
      const launcher = recordingLauncher(log, realpathSync(root));
      const adapter = yield* makeCodexAdapter({ launcher, binary, installedVersion: binaryVersion, authStatus: (path) => authStatus(CodexLauncherLive, path) });
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
              if (event._tag === "notice") yield* Effect.log(`${name}: notice: ${event.text}`);
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
        codexVersion: yield* binaryVersion(binary),
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

await Effect.runPromise(Effect.forEach(names, (name) => record(name, SCENARIOS[name]!, values.model ?? "gpt-5.6-luna"), { discard: true }));
