import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { entryName } from "../../src/features/mcp/vault-tools.js";
import { CLAUDE_STOPPED, makeClaudeCodeAdapter, NOT_ALLOWED, SETTING_SOURCES } from "../../src/features/providers/claude-code/adapter.js";
import { DENIED, ProviderError, vaultToolsUnavailable } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { type FakeSdk, loadFixture, makeFakeSdk, type PlayOptions } from "../fixtures/claude-code/fake-sdk.js";
import { VAULT_FILES } from "../fixtures/claude-code/fixture.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { answer, decode, getThread, interrupt, isTag, newThread, newVaultWith, sendOk, setAgent, status } from "./infrastructure/threads.js";

/** The fake Claude Code the adapter talks to; tests load a recording into it. */
class Fake extends Context.Service<Fake, FakeSdk>()("FakeClaudeCode") {}

const FakeLive = Layer.sync(Fake, makeFakeSdk);

/** Something that is executable, so the adapter finds "claude"; the fake never runs it. */
const BINARY = process.execPath;

const adapterOver = (sdk: FakeSdk["sdk"], signedIn = true) =>
  makeClaudeCodeAdapter({
    sdk,
    binary: BINARY,
    installedVersion: () => Effect.succeed("2.1.316"),
    authStatus: () => Effect.succeed({ loggedIn: signedIn, account: signedIn ? "you@example.com (pro)" : null }),
  });

/** Claude Code (over the fake) and replay. */
const providers = makeProviderRegistry(
  Effect.gen(function* () {
    const fake = yield* Fake;
    return [yield* adapterOver(fake.sdk), ReplayAdapter];
  }),
).pipe(Layer.provide(FakeLive));

const App = Layer.merge(makeTestApp({ providers }), FakeLive);

/** A vault with the recordings' notes, a Claude Code thread in it, and `scenario` loaded. */
const setUp = (scenario: string, options?: PlayOptions) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(VAULT_FILES);
    const fixture = loadFixture(scenario);
    const fake = yield* Fake;
    fake.load(fixture, realpathSync(vault.rootPath), options);
    const thread = yield* newThread(vault.id, "claude-code");
    return { vault, thread, fixture, fake, prompts: fixture.turns.map((turn) => turn.prompt) };
  });

/** Subscribes to the thread's events now; `until` collects them up to the first one matching `done`. */
const watch = (threadId: string) =>
  Effect.gen(function* () {
    const subscription = yield* (yield* ThreadBus).subscribeEvents;
    const seen: Array<ThreadEvent> = [];
    const until = (done: (event: ThreadEvent) => boolean) =>
      Effect.gen(function* () {
        while (true) {
          const stored = yield* PubSub.take(subscription);
          if (stored.threadId !== threadId) continue;
          seen.push(stored.event);
          if (done(stored.event)) return seen;
        }
      });
    /** The next request the turn opens; fails with the turn's reason if it ends first. */
    const request = Effect.gen(function* () {
      const last = (yield* until((event) => event._tag === "request.opened" || event._tag === "turn.finished")).at(-1);
      if (last?._tag !== "request.opened") throw new Error(`the turn ended without asking: ${last?._tag === "turn.finished" ? last.reason : "?"}`);
      return last;
    });
    return { until, request, seen };
  });

const textOf = (events: ReadonlyArray<ThreadEvent>) => events.flatMap((event) => (event._tag === "message.delta" ? [event.text] : [])).join("");

const finishedOf = (events: ReadonlyArray<ThreadEvent>) => {
  const last = events.at(-1);
  if (last?._tag !== "turn.finished") throw new Error(`the turn didn't finish: ${events.map((event) => event._tag).join(", ")}`);
  return last;
};

/** A turn that must complete; fails with the reason otherwise (a fixture mismatch says what differed). */
const completes = (events: ReadonlyArray<ThreadEvent>) => {
  const finished = finishedOf(events);
  expect(finished.reason).toBeNull();
  expect(finished.outcome).toBe("completed");
  return finished;
};

/** Reads a provider turn to its end. */
const drain = Stream.runDrain;

const appended = (options: Options | undefined) => {
  const prompt = options?.systemPrompt;
  return typeof prompt === "object" && !Array.isArray(prompt) && prompt.type === "preset" ? prompt.append : undefined;
};

layer(App)("Claude Code provider", (it) => {
  it.effect("is listed with what it can do, and reports its version and who is signed in", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers.find((provider) => provider.id === "claude-code")).toEqual({
        id: "claude-code",
        kind: "claude-code",
        name: "Claude Code",
        capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: false },
      });
      const { status: ready } = yield* HttpClient.get("/api/providers/claude-code/status").pipe(Effect.flatMap(decode(GetProviderStatusResponse)));
      expect(ready).toEqual({ _tag: "ready", version: "2.1.316", account: "you@example.com (pro)" });
    }),
  );

  it.effect("streams a simple turn in one Claude Code process with the app's options, and keeps the session for the thread", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple");
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));

      const finished = completes(seen);
      expect(finished.turnId).toBe(turnId);
      expect(finished.usage?.inputTokens).toBeGreaterThan(0);
      expect(finished.usage?.outputTokens).toBeGreaterThan(0);
      // A claude.ai login is a subscription: no per-token cost.
      expect(finished.usage?.costUsd).toBeNull();
      expect(textOf(seen)).toMatch(/Coffee|Tea|index/);
      const tools = seen.filter(isTag("tool.called"));
      expect(tools.length).toBeGreaterThan(0);
      expect(seen.filter(isTag("tool.finished"))).toHaveLength(tools.length);

      const [options] = fake.queries();
      const { thread: stored } = yield* getThread(thread.id);
      expect(options).toMatchObject({
        pathToClaudeCodeExecutable: BINARY,
        sessionId: expect.any(String),
        settingSources: SETTING_SOURCES,
        permissionMode: "default",
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code", snapshot: false },
      });
      // The token goes over the control channel, never on the command line.
      expect(options?.mcpServers).toBeUndefined();
      expect(fake.calls).toContainEqual({
        call: "setMcpServers",
        servers: { [entryName(thread.id)]: { type: "http", url: expect.stringMatching(/\/mcp$/), headers: { Authorization: expect.stringMatching(/^Bearer /) } } },
      });
      expect(options?.resume).toBeUndefined();
      expect(stored.status).toBe("idle");
      expect(fake.calls.filter((call) => call.call === "query")).toHaveLength(1);
    }),
  );

  it.effect("keeps one process and conversation across turns", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      for (const prompt of prompts) {
        const events = yield* watch(thread.id);
        yield* sendOk(thread.id, prompt);
        completes(yield* events.until(isTag("turn.finished")));
      }
      expect(fake.calls.filter((call) => call.call === "query")).toHaveLength(1);
      expect(fake.calls.filter((call) => call.call === "send")).toHaveLength(2);
      // The vault tools' token is unchanged, so it is sent once.
      expect(fake.calls.filter((call) => call.call === "setMcpServers")).toHaveLength(1);
      const { events } = yield* getThread(thread.id);
      expect(textOf(events.map((stored) => stored.event)).toLowerCase()).toContain("kiwi");
    }),
  );

  it.effect("gives the vault tools with a bearer token that works at /mcp, and never stores it", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("simple");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* events.until(isTag("turn.finished")));

      const given = fake.calls.find((call) => call.call === "setMcpServers");
      const server = given?.call === "setMcpServers" ? given.servers[entryName(thread.id)] : undefined;
      if (server?.type !== "http") throw new Error("the vault tools weren't given");
      const token = server.headers?.Authorization?.replace(/^Bearer /, "") ?? "";
      const vaultStatus = yield* (yield* mcpSession(token)).result<{ vault: { path: string } }>("vault_status");
      expect(vaultStatus.vault.path).toBe(vault.rootPath);
      expect(JSON.stringify((yield* getThread(thread.id)).events)).not.toContain(token);
    }),
  );

  it.effect("tells you and the agent when Claude Code couldn't connect the vault tools, and the turn runs without them", () =>
    Effect.gen(function* () {
      const notice = vaultToolsUnavailable("Connection refused");
      const { thread, prompts } = yield* setUp("simple", { mcpError: "Connection refused", promptSuffixes: [`\n\nApp notices for this turn:\n${notice}`] });
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(seen.filter(isTag("notice"))).toEqual([{ _tag: "notice", turnId, text: notice }]);
    }),
  );

  it.effect("appends the rules and the agent's instructions, not the AGENTS.md Claude Code reads itself, and restarts on the session when they change", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("multi-turn");
      writeFileSync(join(vault.rootPath, "AGENTS.md"), "# Vault rules\n\nVAULT-ONLY-MARKER");
      yield* setAgent(thread.id, "researcher");
      const first = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* first.until(isTag("turn.finished")));

      const append = appended(fake.queries()[0]) ?? "";
      expect(append).toContain("# Wiki-LLM rules");
      expect(append).toContain("You are the Researcher agent");
      expect(append.indexOf("# Wiki-LLM rules")).toBeLessThan(append.indexOf("You are the Researcher agent"));
      expect(append).not.toContain("VAULT-ONLY-MARKER");

      yield* setAgent(thread.id, "reviewer");
      const second = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[1]!);
      completes(yield* second.until(isTag("turn.finished")));
      const [before, after] = fake.queries();
      expect(fake.calls.map((call) => call.call).filter((call) => call === "query" || call === "close")).toEqual(["query", "close", "query"]);
      expect(after?.resume).toBe(before?.sessionId);
      expect(appended(after)).toContain("You are the Reviewer agent");
    }),
  );

  it.effect("shows an edit as an approval with its diff, and lets Claude Code make it once approved", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("approval-approved");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened).toMatchObject({ _tag: "request.opened", prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      if (opened?._tag !== "request.opened" || opened.prompt._tag !== "approval") throw new Error("no approval");
      expect(opened.prompt.edits?.[0]).toMatchObject({ path: "Notes/Tea.md", patch: expect.stringContaining("+Oolong too.") });
      expect(yield* status(thread.id)).toBe("waiting");

      expect((yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(fake.calls).toContainEqual({ call: "hook", toolName: "Edit", decision: "ask" });
      expect(fake.calls).toContainEqual(expect.objectContaining({ call: "permission", toolName: "Edit", result: expect.objectContaining({ behavior: "allow" }) }));
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "Edit", writes: [join(realpathSync(fake.queries()[0]!.cwd!), "Notes/Tea.md")] }));
    }),
  );

  it.effect("tells the agent why when an edit is denied, and the turn carries on", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("approval-denied");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      if (opened?._tag !== "request.opened") throw new Error("no approval");
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "deny" });
      const seen = yield* events.until(isTag("turn.finished"));

      completes(seen);
      expect(fake.calls).toContainEqual({ call: "permission", toolName: "Edit", result: { behavior: "deny", message: DENIED } });
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed" }));
      expect(textOf(seen).length).toBeGreaterThan(0);
    }),
  );

  it.effect("asks the agent's question and sends your answer", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("question");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened).toMatchObject({ prompt: { _tag: "question", options: expect.arrayContaining(["Earl Grey", "Sencha"]) } });
      if (opened?._tag !== "request.opened" || opened.prompt._tag !== "question") throw new Error("no question");

      yield* answer(thread.id, opened.requestId, { _tag: "question", text: "Sencha" });
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      const permission = fake.calls.find((call) => call.call === "permission");
      expect(permission).toMatchObject({
        toolName: "AskUserQuestion",
        result: { behavior: "allow", updatedInput: { answers: { [opened.prompt.question]: "Sencha" } } },
      });
      expect(textOf(seen)).toContain("Sencha");
    }),
  );

  it.effect("creates a new note without asking and asks before editing, as the researcher's autonomy says", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("create-and-edit");
      yield* setAgent(thread.id, "researcher");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened).toMatchObject({ prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      if (opened?._tag !== "request.opened") throw new Error("no approval");
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" });
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);

      expect(fake.calls.filter((call) => call.call === "hook")).toEqual(
        expect.arrayContaining([
          { call: "hook", toolName: "Write", decision: "allow" },
          { call: "hook", toolName: "Edit", decision: "ask" },
        ]),
      );
      const root = realpathSync(vault.rootPath);
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "Write", writes: [join(root, "Notes/Oolong.md")] }));
    }),
  );

  it.effect("denies a command the agent's autonomy denies, and tells the agent why", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("command-denied");
      yield* setAgent(thread.id, "researcher");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(fake.calls).toContainEqual({ call: "hook", toolName: "Bash", decision: "deny" });
      expect(seen.filter(isTag("request.opened"))).toEqual([]);
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed", output: expect.stringContaining(NOT_ALLOWED.slice(0, 40)) }));
    }),
  );

  it.effect("stops a turn straight after Send", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("interrupt-after-send");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect(finishedOf(yield* events.until(isTag("turn.finished")))).toMatchObject({ outcome: "interrupted", reason: null });
      expect(fake.calls.map((call) => call.call)).toContain("interrupt");
      // Claude Code confirmed the stop, so the process is kept.
      expect(fake.calls.map((call) => call.call)).not.toContain("close");
    }),
  );

  it.effect("stops a turn mid-reply, and the next message continues the conversation", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("interrupt-mid-stream");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* events.until(isTag("message.delta"));
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("interrupted");
      expect(fake.calls.map((call) => call.call)).toContain("interrupt");
      expect(yield* status(thread.id)).toBe("idle");
    }),
  );

  it.effect("fails the turn when Claude Code exits, and the next message resumes the session in a new process", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn", { crashAfter: 3 });
      const first = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const failed = finishedOf(yield* first.until(isTag("turn.finished")));
      expect(failed.outcome).toBe("failed");
      expect(failed.reason).toContain(CLAUDE_STOPPED);

      // Played from its second turn: the session carries on where it was.
      const second = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[1]!);
      completes(yield* second.until(isTag("turn.finished")));
      const [crashed, restarted] = fake.queries();
      expect(restarted?.sessionId ?? restarted?.resume).toBe(crashed?.sessionId);
    }),
  );

  it.effect("lists Claude Code's models, and switches the running process to the one you pick", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      const models = yield* HttpClient.get(`/api/threads/${thread.id}/models`).pipe(Effect.flatMap(decode(ListModelsResponse)));
      expect(models.models.map((model) => model.id)).toEqual(["default", "haiku"]);
      expect(models.current).toBe("default");

      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* events.until(isTag("turn.finished")));
      const put = (model: string) =>
        HttpClient.execute(HttpClientRequest.put(`/api/threads/${thread.id}/model`).pipe(HttpClientRequest.bodyJsonUnsafe({ model })));
      const { thread: updated } = yield* put("haiku").pipe(Effect.flatMap(decode(SetModelResponse)));
      expect(updated.model).toBe("haiku");
      expect(fake.calls).toContainEqual({ call: "setModel", model: "haiku" });
      expect((yield* put("no-such-model")).status).toBe(400);
    }),
  );

  describe("the adapter on its own", () => {
    it.effect("continues the thread's session after a restart, and starts it when Claude Code has never saved it", () =>
      Effect.gen(function* () {
        const fake = makeFakeSdk();
        const vault = yield* newVaultWith(VAULT_FILES);
        const root = realpathSync(vault.rootPath);
        fake.load(loadFixture("multi-turn"), root);
        const adapter = yield* adapterOver(fake.sdk);
        const setup = { instructions: [], autonomy: loadFixture("multi-turn").autonomy, projectRoots: null, vaultTools: null };
        // First run: a new session id, given to Claude Code to create.
        const first = yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* adapter.openSession({ threadId: "t", cwd: root, nativeSessionId: null, model: null, setup });
            yield* drain(session.startTurn({ turnId: "1", text: loadFixture("multi-turn").turns[0]!.prompt, images: [], setup }));
            return session.nativeSessionId;
          }),
        );
        expect(fake.queries()[0]).toMatchObject({ sessionId: first });
        // After a restart: the same id, resumed.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* adapter.openSession({ threadId: "t", cwd: root, nativeSessionId: first, model: "haiku", setup });
            expect(session.nativeSessionId).toBe(first);
            yield* drain(session.startTurn({ turnId: "2", text: loadFixture("multi-turn").turns[1]!.prompt, images: [], setup }));
          }),
        );
        expect(fake.queries()[1]).toMatchObject({ resume: first, model: "haiku" });
        expect(fake.calls.filter((call) => call.call === "close")).toHaveLength(2);
      }),
    );

    it.effect("is unavailable when Claude Code isn't signed in, or isn't installed", () =>
      Effect.gen(function* () {
        const signedOut = yield* adapterOver(makeFakeSdk().sdk, false);
        expect(yield* signedOut.status).toEqual({ _tag: "unavailable", reason: expect.stringContaining("isn't signed in") });
        const missing = yield* makeClaudeCodeAdapter({
          sdk: makeFakeSdk().sdk,
          binary: "wiki-agents-test-no-claude",
          installedVersion: () => Effect.fail(new ProviderError({ message: "unused" })),
          authStatus: () => Effect.fail(new ProviderError({ message: "unused" })),
        });
        expect(yield* missing.status).toEqual({ _tag: "unavailable", reason: expect.stringContaining("Claude Code isn't installed") });
        const old = yield* makeClaudeCodeAdapter({
          sdk: makeFakeSdk().sdk,
          binary: BINARY,
          installedVersion: () => Effect.succeed("1.0.0"),
          authStatus: () => Effect.succeed({ loggedIn: true, account: null }),
        });
        expect(yield* old.status).toEqual({ _tag: "unavailable", reason: "Claude Code 1.0.0 is installed; this app supports 2.1.x." });
      }),
    );
  });
});
