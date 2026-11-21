import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { DRAFT_IDEA_MAX, DRAFT_INSTRUCTIONS_MAX } from "@wiki-agents/contracts/agents/draft-instructions/request";
import { DraftInstructionsResponse } from "@wiki-agents/contracts/agents/draft-instructions/response";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { Effect, Fiber, Latch, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient } from "effect/http";
import { type CompletionInput, type OpenSessionInput, type ProviderAdapter, ProviderError, type ProviderEvent } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { makeTestApp, TestApp } from "./infrastructure/test-app.js";
import { decode, post } from "./infrastructure/threads.js";

const draft = (body: unknown) => post("/api/agents/draft-instructions", body);
const idea = { providerInstanceId: "replay", model: null, idea: "Review incident timelines." };
const researcher = HttpClient.get("/api/agents/researcher").pipe(Effect.flatMap(decode(GetAgentResponse)));

const snapshot = (file: string) => {
  const folder = dirname(file);
  return readdirSync(folder).sort().map((name) => [name, readFileSync(join(folder, name), "utf8")]);
};

layer(TestApp)("draft agent instructions", (it) => {
  it.effect("returns a replay draft without changing any agent files", () =>
    Effect.gen(function* () {
      const agent = yield* researcher;
      const before = snapshot(agent.agent.path);
      const result = yield* draft({ ...idea, name: agent.agent.name, currentInstructions: agent.instructions })
        .pipe(Effect.flatMap(decode(DraftInstructionsResponse)));
      expect(result.instructions).toMatch(/^# Revised role/);
      expect(snapshot(agent.agent.path)).toEqual(before);
    }),
  );

  it.effect("rejects invalid text, a missing provider and unsupported models without writing files", () =>
    Effect.gen(function* () {
      const agent = yield* researcher;
      const before = snapshot(agent.agent.path);
      for (const body of [
        { ...idea, idea: "   " },
        { ...idea, idea: "x".repeat(DRAFT_IDEA_MAX + 1) },
        { ...idea, currentInstructions: "x".repeat(DRAFT_INSTRUCTIONS_MAX + 1) },
        { ...idea, providerInstanceId: "" },
        { ...idea, model: "" },
        { ...idea, model: "unsupported" },
        { ...idea, unrelated: "Do not send this" },
      ]) {
        expect((yield* draft(body)).status).toBe(400);
      }
      expect((yield* draft({ ...idea, providerInstanceId: "missing" })).status).toBe(404);
      expect(snapshot(agent.agent.path)).toEqual(before);
    }),
  );
});

const calls: Array<CompletionInput> = [];
const waitingForAnswer = Latch.makeUnsafe();
const { complete: _replayCompletion, ...sessionAdapter } = ReplayAdapter;

const adapter: ProviderAdapter = {
  ...ReplayAdapter,
  kind: "draft-test",
  capabilities: { ...ReplayAdapter.capabilities, models: true },
  listModels: () => Effect.die("Drafting must bypass ordinary model discovery."),
  listCompletionModels: () => Effect.succeed({
    models: [{ id: "test-model", name: "Test model", free: true, images: false }],
    defaultModel: "test-model",
  }),
  openSession: () => Effect.die("Drafting must not open a tool-capable session."),
  complete: (input) => Effect.gen(function* () {
    calls.push(input);
    expect(readdirSync(input.cwd)).toEqual([]);
    const { idea } = JSON.parse(input.prompt);
    if (idea === "timeout") {
      yield* waitingForAnswer.open;
      return yield* Effect.never;
    }
    if (idea === "fail") return yield* new ProviderError({ message: "Provider refused the request." });
    return { text: idea === "empty" ? "  " : "# Review", usage: null };
  }),
};

const selected = { ...idea, providerInstanceId: adapter.kind, model: "test-model" };

const waitingForModels = Latch.makeUnsafe();
let discoveryDirectory: string | undefined;
let discoveryInterrupted = false;
const stalledDiscovery: ProviderAdapter = {
  ...adapter,
  kind: "stalled-discovery",
  listCompletionModels: (cwd) => Effect.gen(function* () {
    discoveryDirectory = cwd;
    yield* waitingForModels.open;
    return yield* Effect.never;
  }).pipe(Effect.ensuring(Effect.sync(() => { discoveryInterrupted = true; }))),
  complete: () => Effect.die("A stalled model lookup must not start completion."),
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, adapter, stalledDiscovery])) }))("draft provider selection", (it) => {
  it.effect("sends only drafting inputs to the chosen model in a scoped directory without opening a session", () =>
    Effect.gen(function* () {
      const inputs = { idea: selected.idea, name: "Scout", description: "Reviews incidents.", currentInstructions: "Read the report." };
      const result = yield* draft({ ...selected, ...inputs }).pipe(Effect.flatMap(decode(DraftInstructionsResponse)));
      expect(result.instructions).toBe("# Review");
      const call = calls.at(-1)!;
      expect(call.model).toBe("test-model");
      expect(JSON.parse(call.prompt)).toEqual(inputs);
      expect(existsSync(call.cwd)).toBe(false);
    }),
  );

  it.effect("maps unavailable models, provider failures and empty replies without changing agent files", () =>
    Effect.gen(function* () {
      const agent = yield* researcher;
      const before = snapshot(agent.agent.path);
      const count = calls.length;
      expect((yield* draft({ ...selected, model: "missing" })).status).toBe(400);
      expect(calls).toHaveLength(count);
      for (const [idea, message] of [["fail", "Provider refused the request."], ["empty", "The model gave an empty answer."]] as const) {
        const response = yield* draft({ ...selected, idea });
        expect(response.status).toBe(502);
        expect(yield* response.text).toContain(message);
        expect(existsSync(calls.at(-1)!.cwd)).toBe(false);
      }
      expect(snapshot(agent.agent.path)).toEqual(before);
    }),
  );
  it.effect("times out a stalled provider and removes the isolated directory", () =>
    Effect.gen(function* () {
      const request = yield* Effect.forkChild(draft({ ...selected, idea: "timeout" }));
      yield* waitingForAnswer.await;
      const call = calls.at(-1)!;
      expect(existsSync(call.cwd)).toBe(true);
      yield* TestClock.adjust("2 minutes");
      const response = yield* Fiber.join(request);
      expect(response.status).toBe(502);
      expect(yield* response.text).toMatch(/timed out|No answer within/i);
      expect(existsSync(call.cwd)).toBe(false);
    }),
  );
  it.effect("times out cold model discovery before generation and removes the isolated directory", () =>
    Effect.gen(function* () {
      const request = yield* Effect.forkChild(draft({ ...selected, providerInstanceId: stalledDiscovery.kind }));
      yield* waitingForModels.await;
      expect(existsSync(discoveryDirectory!)).toBe(true);
      yield* TestClock.adjust("2 minutes");
      const response = yield* Fiber.join(request);
      expect(response.status).toBe(502);
      expect(yield* response.text).toContain("Draft generation timed out.");
      expect(discoveryInterrupted).toBe(true);
      expect(existsSync(discoveryDirectory!)).toBe(false);
    }),
  );
});

const fallbackSessions: Array<{
  input: OpenSessionInput;
  stopped: boolean;
  closed: boolean;
  answered: boolean;
}> = [];
const fallbackDiscovery: Array<string> = [];
const fallbackWaiting = Latch.makeUnsafe();
const disconnectWaiting = Latch.makeUnsafe();
const disconnectClosed = Latch.makeUnsafe();

const fallback: ProviderAdapter = {
  ...sessionAdapter,
  kind: "session-only",
  capabilities: { ...sessionAdapter.capabilities, models: true },
  listModels: (cwd) => Effect.sync(() => {
    fallbackDiscovery.push(cwd);
    return { models: [{ id: "small", name: "Small", free: false, images: false }], defaultModel: "small" };
  }),
  openSession: (input) => Effect.gen(function* () {
    expect(readdirSync(input.cwd)).toEqual([]);
    const session = { input, stopped: false, closed: false, answered: false };
    fallbackSessions.push(session);
    let disconnectTest = false;
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      expect(existsSync(input.cwd)).toBe(true);
      session.closed = true;
      if (disconnectTest) disconnectClosed.openUnsafe();
    }));
    return {
      nativeSessionId: "stand-in",
      startTurn: ({ turnId, text, setup, images }) => {
        expect(setup).toBe(input.setup);
        expect(images).toEqual([]);
        const request = JSON.parse(text);
        expect(Object.keys(request)).toEqual(["idea"]);
        if (request.idea === "ask") {
          return Stream.concat(Stream.succeed<ProviderEvent>({
            _tag: "request.opened", turnId, requestId: "prompt", prompt: { _tag: "approval", title: "Read", detail: "Read a file" },
          }), Stream.never);
        }
        if (request.idea === "disconnect") {
          disconnectTest = true;
          return Stream.unwrap(Effect.as(disconnectWaiting.open, Stream.never));
        }
        if (request.idea === "timeout") return Stream.unwrap(Effect.as(fallbackWaiting.open, Stream.never));
        if (request.idea === "fail") return Stream.fail(new ProviderError({ message: "Session failed." }));
        return Stream.fromIterable<ProviderEvent>([
          { _tag: "message.delta", turnId, messageId: "draft", text: "# Fallback draft" },
          { _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null },
        ]);
      },
      resumeTurn: () => Effect.succeedNone,
      interrupt: () => Effect.sync(() => { session.stopped = true; }),
      answerRequest: () => Effect.sync(() => { session.answered = true; }),
      setModel: () => Effect.void,
    };
  }),
};

const fallbackRequest = { ...idea, providerInstanceId: fallback.kind };

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([fallback])) }))("session-backed drafts", (it) => {
  it.effect("validates an explicit model and leaves the provider default implicit", () =>
    Effect.gen(function* () {
      const agent = yield* researcher;
      const before = snapshot(agent.agent.path);
      expect((yield* draft({ ...fallbackRequest, model: "missing" })).status).toBe(400);
      const count = fallbackDiscovery.length;
      for (const model of ["small", null] as const) {
        const result = yield* draft({ ...fallbackRequest, model }).pipe(Effect.flatMap(decode(DraftInstructionsResponse)));
        expect(result.instructions).toBe("# Fallback draft");
        const session = fallbackSessions.at(-1)!;
        expect(session.input).toMatchObject({
          model,
          nativeSessionId: null,
          setup: {
            autonomy: { read: "deny", create: "deny", edit: "deny", commands: "deny", web: "deny", tools: "deny", subagents: "deny", threads: "deny" },
            projectRoots: [session.input.cwd],
            attachmentFolders: [],
            vaultTools: null,
          },
        });
        expect(session.input.setup.instructions).toEqual([expect.objectContaining({ source: "rules", path: session.input.cwd, text: expect.stringContaining("Write Markdown instructions") })]);
        if (model !== null) expect(fallbackDiscovery.at(-1)).toBe(session.input.cwd);
        expect(session.closed).toBe(true);
        expect(existsSync(session.input.cwd)).toBe(false);
      }
      expect(fallbackDiscovery).toHaveLength(count + 1);
      expect(snapshot(agent.agent.path)).toEqual(before);
    }),
  );

  it.effect("stops sessions on request, failure and timeout before removing their directory", () =>
    Effect.gen(function* () {
      for (const [idea, message] of [["ask", "The model asked for something instead of answering."], ["fail", "Session failed."]] as const) {
        const response = yield* draft({ ...fallbackRequest, idea });
        expect(response.status).toBe(502);
        expect(yield* response.text).toBe(message);
        const session = fallbackSessions.at(-1)!;
        expect(session).toMatchObject({ stopped: true, closed: true, answered: false });
        expect(existsSync(session.input.cwd)).toBe(false);
      }

      const request = yield* Effect.forkChild(draft({ ...fallbackRequest, idea: "timeout" }));
      yield* fallbackWaiting.await;
      yield* TestClock.adjust("2 minutes");
      expect((yield* Fiber.join(request)).status).toBe(502);
      const session = fallbackSessions.at(-1)!;
      expect(session).toMatchObject({ stopped: true, closed: true, answered: false });
      expect(existsSync(session.input.cwd)).toBe(false);
    }),
  );

  it.effect("stops and closes an in-flight session when the HTTP client disconnects", () =>
    Effect.gen(function* () {
      const request = yield* Effect.forkChild(draft({ ...fallbackRequest, idea: "disconnect" }));
      yield* disconnectWaiting.await;
      const session = fallbackSessions.at(-1)!;
      yield* Fiber.interrupt(request);
      yield* disconnectClosed.await;
      expect(session).toMatchObject({ stopped: true, closed: true, answered: false });
    }),
  );
});
