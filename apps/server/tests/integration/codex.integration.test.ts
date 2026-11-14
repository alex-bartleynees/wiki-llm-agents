import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { CODEX_STOPPED, makeCodexAdapter, NOT_ALLOWED, TOKEN_ENV } from "../../src/features/providers/codex/adapter.js";
import { VAULT_SERVER } from "../../src/features/providers/codex/events.js";
import { DENIED, ProviderError, vaultToolsUnavailable } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { type FakeAppServer, loadFixture, makeFakeAppServer, type PlayOptions } from "../fixtures/codex/fake-app-server.js";
import { VAULT_FILES } from "../fixtures/codex/fixture.js";
import { RED_SQUARE, sha256 } from "../fixtures/image.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { answer, decode, getThread, interrupt, isTag, newThread, newVaultWith, sendOk, sendWithOk, setAgent, status, uploadOk } from "./infrastructure/threads.js";

/** The scripted Codex app-server the adapter talks to; tests load a recording into it. */
class Fake extends Context.Service<Fake, FakeAppServer>()("FakeCodex") {}

const FakeLive = Layer.sync(Fake, makeFakeAppServer);

/** Something that is executable, so the adapter finds "codex"; the fake never runs it. */
const BINARY = process.execPath;

const adapterOver = (fake: FakeAppServer, signedIn = true) =>
  makeCodexAdapter({
    launcher: fake.launcher,
    binary: BINARY,
    installedVersion: () => Effect.succeed("0.166.0"),
    authStatus: () => Effect.succeed({ loggedIn: signedIn, account: signedIn ? "you@example.com (plus)" : null }),
  });

/** Codex (over the fake) and replay. */
const providers = makeProviderRegistry(
  Effect.gen(function* () {
    const fake = yield* Fake;
    return [yield* adapterOver(fake), ReplayAdapter];
  }),
).pipe(Layer.provide(FakeLive));

const App = Layer.merge(makeTestApp({ providers }), FakeLive);

/** A vault with the recordings' notes, a Codex thread in it, and `scenario` loaded. */
const setUp = (scenario: string, options?: PlayOptions) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(VAULT_FILES);
    const fixture = loadFixture(scenario);
    const fake = yield* Fake;
    fake.load(fixture, realpathSync(vault.rootPath), options);
    const thread = yield* newThread(vault.id, "codex");
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

/** What the adapter answered Codex's requests, in order. */
const responses = (fake: FakeAppServer) => fake.calls.flatMap((call) => (call.call === "respond" ? [call.result] : []));

/** Runs one recorded turn to its end, answering its requests with `reply`. */
const playTurn = (threadId: string, prompt: string) =>
  Effect.gen(function* () {
    const events = yield* watch(threadId);
    yield* sendOk(threadId, prompt);
    return yield* events.until(isTag("turn.finished"));
  });

layer(App)("Codex provider", (it) => {
  it.effect("is listed with what it can do, and reports its version and who is signed in", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers.find((provider) => provider.id === "codex")).toEqual({
        id: "codex",
        kind: "codex",
        name: "Codex",
        capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true },
      });
      const { status: ready } = yield* HttpClient.get("/api/providers/codex/status").pipe(Effect.flatMap(decode(GetProviderStatusResponse)));
      expect(ready).toEqual({ _tag: "ready", version: "0.166.0", account: "you@example.com (plus)" });
    }),
  );

  it.effect("sends an attached image as a localImage by its path, before the text, and the model sees it", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("image");
      const image = yield* uploadOk(RED_SQUARE.name, RED_SQUARE.bytes);
      const events = yield* watch(thread.id);
      yield* sendWithOk(thread.id, prompts[0]!, [image.id]);
      const seen = yield* events.until(isTag("turn.finished"));

      completes(seen);
      expect(textOf(seen)).toMatch(/red/i);
      expect(fake.requests("turn/start")[0]?.input).toEqual([
        { type: "localImage", path: expect.stringMatching(new RegExp(`/${sha256(RED_SQUARE.bytes)}/red-square\\.png$`)) },
        { type: "text", text: prompts[0], text_elements: [] },
      ]);
    }),
  );

  it.effect("streams a simple turn in one app-server, in the read-only sandbox, and keeps the Codex thread for the app's thread", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple");
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));

      const finished = completes(seen);
      expect(finished.turnId).toBe(turnId);
      expect(finished.usage?.inputTokens).toBeGreaterThan(0);
      expect(finished.usage?.outputTokens).toBeGreaterThan(0);
      // A ChatGPT plan: no per-token cost.
      expect(finished.usage?.costUsd).toBeNull();
      expect(textOf(seen)).toMatch(/Coffee|Tea|index/);
      const tools = seen.filter(isTag("tool.called"));
      expect(tools.length).toBeGreaterThan(0);
      expect(seen.filter(isTag("tool.finished"))).toHaveLength(tools.length);
      // Commands that only read ran in the sandbox: nothing was asked.
      expect(seen.filter(isTag("request.opened"))).toEqual([]);

      const [started] = fake.requests("thread/start");
      expect(started).toMatchObject({
        approvalPolicy: "on-request",
        sandbox: "read-only",
        developerInstructions: expect.stringContaining("# Wiki-LLM rules"),
        config: { web_search: "disabled", [`mcp_servers.${VAULT_SERVER}`]: { url: expect.stringMatching(/\/mcp$/), bearer_token_env_var: TOKEN_ENV } },
      });
      const { thread: stored } = yield* getThread(thread.id);
      expect(stored.status).toBe("idle");
      expect(fake.launches()).toHaveLength(1);
    }),
  );

  it.effect("keeps one app-server and Codex thread across turns", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      for (const prompt of prompts) completes(yield* playTurn(thread.id, prompt));
      expect(fake.launches()).toHaveLength(1);
      expect(fake.requests("turn/start")).toHaveLength(2);
      const { events } = yield* getThread(thread.id);
      expect(textOf(events.map((stored) => stored.event)).toLowerCase()).toContain("kiwi");
    }),
  );

  it.effect("gives the vault tools a token in the app-server's environment only, which works at /mcp and is never stored", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("simple");
      completes(yield* playTurn(thread.id, prompts[0]!));

      const token = fake.launches()[0]?.env[TOKEN_ENV] ?? "";
      expect(token).not.toBe("");
      // Not in anything sent to Codex: only the variable's name is.
      expect(JSON.stringify(fake.calls.filter((call) => call.call !== "launch"))).not.toContain(token);
      const vaultStatus = yield* (yield* mcpSession(token)).result<{ vault: { path: string } }>("vault_status");
      expect(vaultStatus.vault.path).toBe(vault.rootPath);
      expect(JSON.stringify((yield* getThread(thread.id)).events)).not.toContain(token);
    }),
  );

  it.effect("tells you when Codex couldn't start the vault tools, and the turn runs without them", () =>
    Effect.gen(function* () {
      const { thread, prompts } = yield* setUp("simple", { mcpError: "Connection refused" });
      const seen = yield* playTurn(thread.id, prompts[0]!);
      completes(seen);
      expect(seen.flatMap((event) => (event._tag === "notice" ? [event.text] : []))).toEqual([vaultToolsUnavailable("Connection refused")]);
    }),
  );

  it.effect("sends the rules and the agent's instructions as developer instructions, not the AGENTS.md Codex reads itself, and resumes the thread in a new app-server when they change", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("multi-turn");
      writeFileSync(join(vault.rootPath, "AGENTS.md"), "# Vault rules\n\nVAULT-ONLY-MARKER");
      yield* setAgent(thread.id, "researcher");
      completes(yield* playTurn(thread.id, prompts[0]!));

      const [started] = fake.requests("thread/start");
      const instructions = String(started?.developerInstructions);
      expect(instructions).toContain("# Wiki-LLM rules");
      expect(instructions).toContain("You are the Researcher agent");
      expect(instructions.indexOf("# Wiki-LLM rules")).toBeLessThan(instructions.indexOf("You are the Researcher agent"));
      expect(instructions).not.toContain("VAULT-ONLY-MARKER");
      // The researcher may use the web: Codex's web search is on.
      expect(started?.config).toMatchObject({ web_search: "live" });

      yield* setAgent(thread.id, "reviewer");
      completes(yield* playTurn(thread.id, prompts[1]!));
      expect(fake.calls.map((call) => call.call).filter((call) => call === "launch" || call === "kill")).toEqual(["launch", "kill", "launch"]);
      const [resumed] = fake.requests("thread/resume");
      expect(resumed?.threadId).toEqual(expect.any(String));
      expect(String(resumed?.developerInstructions)).toContain("You are the Reviewer agent");
    }),
  );

  it.effect("shows a patch as an approval with its diff, and lets Codex apply it once approved", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("approval-approved");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened).toMatchObject({ _tag: "request.opened", prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      if (opened.prompt._tag !== "approval") throw new Error("no approval");
      expect(opened.prompt.edits?.[0]).toMatchObject({ path: "Notes/Tea.md", patch: expect.stringMatching(/^--- Notes\/Tea\.md\n\+\+\+ Notes\/Tea\.md\n@@[^\n]*\n[\s\S]*\+Oolong too\./) });
      expect(yield* status(thread.id)).toBe("waiting");

      expect((yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(responses(fake)).toEqual([{ decision: "accept" }]);
      const tea = join(realpathSync(vault.rootPath), "Notes/Tea.md");
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "edit", input: "Notes/Tea.md", writes: [tea] }));
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "succeeded", writes: [tea] }));
    }),
  );

  it.effect("declines a patch you deny, says so in the step, and the turn carries on", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("approval-denied");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "deny" });
      const seen = yield* events.until(isTag("turn.finished"));

      completes(seen);
      expect(responses(fake)).toEqual([{ decision: "decline" }]);
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed", output: DENIED }));
      expect(textOf(seen).length).toBeGreaterThan(0);
    }),
  );

  it.effect("asks before a command that needs more than the read-only sandbox, and runs it once approved", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("command-approved");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened.prompt).toMatchObject({ _tag: "approval", title: "Run mkdir Drafts", detail: expect.stringContaining("mkdir Drafts") });
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" });
      completes(yield* events.until(isTag("turn.finished")));
      expect(responses(fake)).toEqual([{ decision: "accept" }]);
    }),
  );

  it.effect("asks the agent's question and sends your answer", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("question");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.request;
      expect(opened.prompt).toMatchObject({ _tag: "question", question: "Which tea do you prefer?", options: expect.arrayContaining(["Sencha"]) });

      yield* answer(thread.id, opened.requestId, { _tag: "question", text: "Sencha" });
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(responses(fake)).toEqual([{ answers: { tea_preference: { answers: ["Sencha"] } } }]);
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
      expect(opened.prompt).toMatchObject({ _tag: "approval", title: "Edit Notes/Tea.md" });
      yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" });
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);

      // The create was answered from the autonomy; only the edit was asked.
      expect(responses(fake)).toEqual([{ decision: "accept" }, { decision: "accept" }]);
      expect(seen.filter(isTag("request.opened"))).toHaveLength(1);
      const root = realpathSync(vault.rootPath);
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "create", writes: [join(root, "Notes/Oolong.md")] }));
    }),
  );

  it.effect("declines a command the agent's autonomy denies, without asking you", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("command-denied");
      yield* setAgent(thread.id, "researcher");
      const seen = yield* playTurn(thread.id, prompts[0]!);
      completes(seen);
      expect(responses(fake)).toEqual([{ decision: "decline" }]);
      expect(seen.filter(isTag("request.opened"))).toEqual([]);
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed", output: NOT_ALLOWED }));
    }),
  );

  it.effect("stops a turn straight after Send", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("interrupt-after-send");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect(finishedOf(yield* events.until(isTag("turn.finished")))).toMatchObject({ outcome: "interrupted", reason: null });
      expect(fake.requests("turn/interrupt")).toHaveLength(1);
      // Codex confirmed the stop, so the app-server is kept.
      expect(fake.calls.map((call) => call.call)).not.toContain("kill");
    }),
  );

  it.effect("stops a turn mid-reply", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("interrupt-mid-stream");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* events.until(isTag("message.delta"));
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("interrupted");
      expect(fake.requests("turn/interrupt")[0]).toMatchObject({ turnId: expect.any(String) });
      expect(yield* status(thread.id)).toBe("idle");
    }),
  );

  it.effect("fails the turn when Codex exits, and the next message starts a new app-server", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn", { crashAfter: 1 });
      const failed = finishedOf(yield* playTurn(thread.id, prompts[0]!));
      expect(failed.outcome).toBe("failed");
      expect(failed.reason).toContain(CODEX_STOPPED);
      expect(failed.reason).toContain("Codex crashed");

      completes(yield* playTurn(thread.id, prompts[1]!));
      expect(fake.launches()).toHaveLength(2);
      // Codex never saved the crashed thread (it had no finished turn): resuming it fails, so a new one starts.
      const [started, restarted] = fake.requests("thread/start");
      expect(fake.requests("thread/resume")).toEqual([expect.objectContaining({ threadId: expect.any(String) })]);
      expect(restarted).toMatchObject({ cwd: started?.cwd });
    }),
  );

  it.effect("lists Codex's models, and sends the one you pick with the next turn", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      const models = yield* HttpClient.get(`/api/threads/${thread.id}/models`).pipe(Effect.flatMap(decode(ListModelsResponse)));
      // Hidden models aren't offered.
      expect(models.models.map((model) => model.id)).toEqual(["gpt-6.1-sol", "gpt-5.6-luna"]);
      expect(models.current).toBe("gpt-6.1-sol");

      completes(yield* playTurn(thread.id, prompts[0]!));
      const put = (model: string) =>
        HttpClient.execute(HttpClientRequest.put(`/api/threads/${thread.id}/model`).pipe(HttpClientRequest.bodyJsonUnsafe({ model })));
      const { thread: updated } = yield* put("gpt-5.6-luna").pipe(Effect.flatMap(decode(SetModelResponse)));
      expect(updated.model).toBe("gpt-5.6-luna");
      expect((yield* put("no-such-model")).status).toBe(400);
      completes(yield* playTurn(thread.id, prompts[1]!));
      expect(fake.requests("turn/start").map((params) => params.model)).toEqual([undefined, "gpt-5.6-luna"]);
    }),
  );

  describe("the adapter on its own", () => {
    it.effect("resumes the thread's Codex thread after a restart", () =>
      Effect.gen(function* () {
        const fake = makeFakeAppServer();
        const vault = yield* newVaultWith(VAULT_FILES);
        const root = realpathSync(vault.rootPath);
        const fixture = loadFixture("multi-turn");
        fake.load(fixture, root);
        const adapter = yield* adapterOver(fake);
        const setup = { instructions: [], autonomy: fixture.autonomy, projectRoots: null, vaultTools: null };
        const first = yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* adapter.openSession({ threadId: "t", cwd: root, nativeSessionId: null, model: null, setup });
            yield* Stream.runDrain(session.startTurn({ turnId: "1", text: fixture.turns[0]!.prompt, images: [], setup }));
            return session.nativeSessionId;
          }),
        );
        expect(first).toEqual(expect.any(String));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* adapter.openSession({ threadId: "t", cwd: root, nativeSessionId: first, model: "gpt-5.6-luna", setup });
            expect(session.nativeSessionId).toBe(first);
            yield* Stream.runDrain(session.startTurn({ turnId: "2", text: fixture.turns[1]!.prompt, images: [], setup }));
          }),
        );
        expect(fake.requests("thread/resume")).toEqual([expect.objectContaining({ threadId: first, model: "gpt-5.6-luna", sandbox: "read-only" })]);
        expect(fake.calls.filter((call) => call.call === "kill")).toHaveLength(2);
        // No vault tools: no server configured and no token in the environment.
        expect(fake.launches().map((launch) => launch.env)).toEqual([{}, {}]);
      }),
    );

    it.effect("is unavailable when Codex isn't signed in, isn't installed, or is too old", () =>
      Effect.gen(function* () {
        const signedOut = yield* adapterOver(makeFakeAppServer(), false);
        expect(yield* signedOut.status).toEqual({ _tag: "unavailable", reason: expect.stringContaining("isn't signed in") });
        const missing = yield* makeCodexAdapter({
          launcher: makeFakeAppServer().launcher,
          binary: "wiki-agents-test-no-codex",
          installedVersion: () => Effect.fail(new ProviderError({ message: "unused" })),
          authStatus: () => Effect.fail(new ProviderError({ message: "unused" })),
        });
        expect(yield* missing.status).toEqual({ _tag: "unavailable", reason: expect.stringContaining("Codex isn't installed") });
        const old = yield* makeCodexAdapter({
          launcher: makeFakeAppServer().launcher,
          binary: BINARY,
          installedVersion: () => Effect.succeed("0.100.0"),
          authStatus: () => Effect.succeed({ loggedIn: true, account: null }),
        });
        expect(yield* old.status).toEqual({ _tag: "unavailable", reason: "Codex 0.100.0 is installed; this app supports 0.166.0 or later 0.x releases." });
      }),
    );
  });
});
