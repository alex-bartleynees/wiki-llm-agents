import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import type { AppServerProcess, CodexLauncher, LaunchOptions } from "../../../src/features/providers/codex/app-server.js";
import { VAULT_SERVER } from "../../../src/features/providers/codex/events.js";
import type { JsonRpcId, JsonRpcMessage, Model } from "../../../src/features/providers/codex/protocol.js";
import { type Fixture, HOME, THREAD, VAULT } from "./fixture.js";

export const loadFixture = (scenario: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./${scenario}.json`, import.meta.url), "utf8")) as Fixture;

export const FAKE_MODELS: ReadonlyArray<Model> = [
  { id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", hidden: false, isDefault: true },
  { id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6-Luna", hidden: false, isDefault: false },
  { id: "codex-auto-review", model: "codex-auto-review", displayName: "Codex Auto Review", hidden: true, isDefault: false },
];

export interface PlayOptions {
  /** Text the app adds after each recorded prompt (supplied notes, notices). */
  readonly promptSuffixes?: ReadonlyArray<string>;
  /** Codex exits after this many steps of the first turn played. */
  readonly crashAfter?: number;
  /** Why the vault tools' MCP server fails to start; it starts when unset. */
  readonly mcpError?: string;
}

/** What the adapter asked of Codex, in order. */
export type FakeCall =
  | { readonly call: "launch"; readonly options: LaunchOptions }
  | { readonly call: "request"; readonly method: string; readonly params: unknown }
  | { readonly call: "respond"; readonly id: JsonRpcId; readonly result: unknown }
  | { readonly call: "kill" };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Codex's app-server playing a recorded conversation: the handshake, threads and
 * model list are answered here; each `turn/start` plays the next recorded turn,
 * whose requests the adapter must answer as it did when recorded (a different
 * answer fails the turn saying so), pausing at a recorded Stop until the adapter
 * sends `turn/interrupt`. A new process (a restart) resumes the thread and carries
 * on with the next turn.
 */
export const makeFakeAppServer = () => {
  const calls: Array<FakeCall> = [];
  /** Threads Codex has saved (after their first turn), which `thread/resume` finds. */
  const saved = new Set<string>();
  let fixture: Fixture | undefined;
  let root = "";
  let options: PlayOptions = {};
  let turn = 0;
  let crashes = 0;

  const launch = (launched: LaunchOptions): AppServerProcess => {
    calls.push({ call: "launch", options: launched });
    let handlers: Parameters<AppServerProcess["listen"]>[0] | undefined;
    let closed = false;
    let threadId = "";
    let toolsConfigured = false;
    const answers = new Map<JsonRpcId, (result: unknown) => void>();
    let stop: (() => void) | undefined;
    let stopped = false;

    const restore = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value).replaceAll(VAULT, root).replaceAll(THREAD, threadId).replaceAll(HOME, homedir()));
    const emit = async (message: JsonRpcMessage) => {
      await tick();
      if (!closed) handlers?.message(message);
    };
    const exit = (reason: string | null) => {
      if (closed) return;
      closed = true;
      handlers?.exit(reason);
    };
    const reply = (id: JsonRpcId | undefined, result: unknown) => (id === undefined ? Promise.resolve() : emit({ id, result }));
    const fail = (id: JsonRpcId | undefined, message: string) => (id === undefined ? Promise.resolve() : emit({ id, error: { code: -32600, message } }));

    const failTurn = (codexTurnId: string, message: string) =>
      emit({ method: "turn/completed", params: { threadId, turn: { id: codexTurnId, status: "failed", error: { message, additionalDetails: null } } } });

    const play = async (index: number, codexTurnId: string) => {
      const recorded = fixture?.turns[index];
      if (recorded === undefined) return;
      stopped = false;
      if (toolsConfigured && options.mcpError !== undefined) {
        await emit({ method: "mcpServer/startupStatus/updated", params: { threadId, name: VAULT_SERVER, status: "failed", error: options.mcpError, failureReason: null } });
      }
      let played = 0;
      for (const step of recorded.steps) {
        if (closed) return;
        if (options.crashAfter !== undefined && crashes === 0 && played++ >= options.crashAfter) {
          crashes += 1;
          await tick();
          return exit("exit code 1: Codex crashed");
        }
        if ("interrupt" in step) {
          if (!stopped) await new Promise<void>((resolve) => (stop = resolve));
          continue;
        }
        if ("response" in step) continue;
        const message = restore(step.message) as JsonRpcMessage;
        if (message.method === "turn/completed") saved.add(threadId);
        if (message.id === undefined) {
          await emit(message);
          continue;
        }
        // A request: wait for the adapter's answer, which must be the recorded one.
        const expected = recorded.steps.find((other) => "response" in other && other.response.id === message.id);
        const answered = new Promise<unknown>((resolve) => answers.set(message.id!, resolve));
        await emit(message);
        const result = await answered;
        if (closed) return;
        const want = expected !== undefined && "response" in expected ? restore(expected.response.result) : undefined;
        if (!isDeepStrictEqual(result, want)) return failTurn(codexTurnId, `the adapter answered ${message.method} with ${JSON.stringify(result)}; recorded ${JSON.stringify(want)}`);
      }
    };

    const receive = (message: JsonRpcMessage) => {
      if (closed) return;
      if (message.method === undefined) {
        if (message.id === undefined) return;
        calls.push({ call: "respond", id: message.id, result: message.result ?? message.error });
        answers.get(message.id)?.(message.result ?? message.error);
        answers.delete(message.id);
        return;
      }
      if (message.method === "initialized") return;
      calls.push({ call: "request", method: message.method, params: message.params });
      const params = (message.params ?? {}) as Record<string, unknown>;
      switch (message.method) {
        case "initialize":
          return void reply(message.id, { userAgent: "codex-fake", codexHome: `${homedir()}/.codex`, platformFamily: "unix", platformOs: "linux" });
        case "account/read":
          return void reply(message.id, { account: { type: "chatgpt", email: "you@example.com", planType: "plus" }, requiresOpenaiAuth: true });
        case "model/list":
          return void reply(message.id, { data: FAKE_MODELS, nextCursor: null });
        case "thread/start":
        case "thread/resume": {
          if (message.method === "thread/resume" && !saved.has(String(params.threadId))) return void fail(message.id, `no rollout found for thread id ${String(params.threadId)}`);
          threadId = message.method === "thread/resume" ? String(params.threadId) : randomUUID();
          toolsConfigured = Object.keys((params.config ?? {}) as object).includes(`mcp_servers.${VAULT_SERVER}`);
          return void reply(message.id, { thread: { id: threadId }, model: String(params.model ?? fixture?.model ?? "gpt-6.1-sol") });
        }
        case "turn/start": {
          if (fixture === undefined) return void fail(message.id, "no fixture loaded");
          const index = turn;
          const recorded = fixture.turns[index];
          turn += 1;
          if (recorded === undefined) return void fail(message.id, `the fixture has no turn ${index + 1}`);
          const input = (params.input as ReadonlyArray<{ readonly text: string }>)[0]?.text;
          const expected = recorded.prompt + (options.promptSuffixes?.[index] ?? "");
          if (input !== expected) return void fail(message.id, `sent ${JSON.stringify(input)}, recorded ${JSON.stringify(expected)}`);
          const started = recorded.steps.find((step) => "message" in step && step.message.method === "turn/started");
          const codexTurnId = started !== undefined && "message" in started ? (started.message.params as { turn: { id: string } }).turn.id : `turn-${index}`;
          void reply(message.id, { turn: { id: codexTurnId, status: "inProgress", items: [], error: null } }).then(() => play(index, codexTurnId));
          return;
        }
        case "turn/interrupt":
          stopped = true;
          stop?.();
          return void reply(message.id, {});
        default:
          return void fail(message.id, `the fake app-server doesn't know ${message.method}`);
      }
    };

    return {
      send: receive,
      listen: (next) => {
        handlers = next;
      },
      kill: () => {
        if (closed) return;
        calls.push({ call: "kill" });
        stop?.();
        exit(null);
      },
    };
  };

  const launcher: CodexLauncher = { launch };

  return {
    launcher,
    calls,
    /** Plays `next` from its first turn, in `vault`, and forgets earlier calls. */
    load: (next: Fixture, vault: string, play: PlayOptions = {}) => {
      fixture = next;
      root = vault;
      options = play;
      calls.length = 0;
      turn = 0;
      crashes = 0;
    },
    /** The adapter's requests of `method`, with their params, in order. */
    requests: (method: string) => calls.flatMap((call) => (call.call === "request" && call.method === method ? [call.params as Record<string, unknown>] : [])),
    launches: () => calls.flatMap((call) => (call.call === "launch" ? [call.options] : [])),
  };
};

export type FakeAppServer = ReturnType<typeof makeFakeAppServer>;
