import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { DRAFT_IDEA_MAX, DRAFT_INSTRUCTIONS_MAX } from "@wiki-agents/contracts/agents/draft-instructions/request";
import { DraftInstructionsResponse } from "@wiki-agents/contracts/agents/draft-instructions/response";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { Effect, Fiber, Latch } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient } from "effect/http";
import { type CompletionInput, type ProviderAdapter, ProviderError } from "../../src/features/providers/port.js";
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

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, adapter, stalledDiscovery, { ...sessionAdapter, kind: "session-only" }])) }))("draft provider selection", (it) => {
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
      expect((yield* draft({ ...idea, providerInstanceId: "session-only" })).status).toBe(400);
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
