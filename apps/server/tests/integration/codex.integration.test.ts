import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { DraftInstructionsResponse } from "@wiki-agents/contracts/agents/draft-instructions/response";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Context, Deferred, Effect, Fiber, Layer, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientRequest } from "effect/http";
import { CODEX_STOPPED, makeCodexAdapter, NOT_ALLOWED, TOKEN_ENV } from "../../src/features/providers/codex/adapter.js";
import { VAULT_SERVER } from "../../src/features/providers/codex/events.js";
import { PERMISSION_PROFILE, protectedEntries } from "../../src/features/providers/codex/permissions.js";
import { SecretMaterial } from "../../src/features/secrets/material.js";
import { DENIED, ProviderError, vaultToolsUnavailable } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { type FakeAppServer, loadFixture, makeFakeAppServer, type PlayOptions } from "../fixtures/codex/fake-app-server.js";
import { type FixtureStep, VAULT_FILES } from "../fixtures/codex/fixture.js";
import { CSV_PROMPT, SALES_CSV, SALES_TOTAL } from "../fixtures/csv.js";
import { RED_SQUARE, sha256 } from "../fixtures/image.js";
import { setSecret } from "./infrastructure/browser-sign-ins.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { answer, compactOk, decode, getThread, interrupt, isTag, newThread, newVaultWith, post, sendOk, sendWithOk, setAgent, status, uploadOk } from "./infrastructure/threads.js";

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

const draftWithCodex = (idea: string, model: string | null = null) =>
  post("/api/agents/draft-instructions", { idea, providerInstanceId: "codex", model });

const draftFixture = (name: string, idea: string) => {
  const fixture = loadFixture(name);
  return { ...fixture, turns: [{ ...fixture.turns[0]!, prompt: JSON.stringify({ idea }) }] };
};

const closeProbe = Effect.gen(function* () {
  const closing = yield* Deferred.make<string>();
  const released = yield* Deferred.make<void>();
  return {
    closing: Deferred.await(closing),
    release: Deferred.succeed(released, undefined),
    beforeClose: ({ cwd }: { cwd: string }) => {
      Deferred.doneUnsafe(closing, Effect.succeed(cwd));
      return Effect.runPromise(Deferred.await(released));
    },
  };
});

layer(App)("Codex draft teardown", (it) => {
  it.effect("interrupts a pending question and cancels it before waiting for the process to close", () =>
    Effect.gen(function* () {
      const fake = yield* Fake;
      const probe = yield* closeProbe;
      const idea = "Draft a reviewer.";
      const fixture = draftFixture("question", idea);
      const turn = fixture.turns[0]!;
      const steps = turn.steps.flatMap<FixtureStep>((step) => "response" in step
        ? [{ response: { id: step.response.id, result: { answers: {} } } }, { interrupt: true as const }]
        : [step]);
      fake.load({ ...fixture, turns: [{ ...turn, steps }] }, "/tmp", { beforeClose: probe.beforeClose });
      yield* Effect.gen(function* () {
        const result = yield* Effect.forkChild(draftWithCodex(idea));
        const cwd = yield* probe.closing;
        expect(existsSync(cwd)).toBe(true);
        expect(fake.requests("turn/interrupt")).toHaveLength(1);
        const stop = fake.calls.findIndex((call) => call.call === "request" && call.method === "turn/interrupt");
        const cancel = fake.calls.findIndex((call) => call.call === "respond");
        const kill = fake.calls.findIndex((call) => call.call === "kill");
        expect(stop).toBeGreaterThanOrEqual(0);
        expect(cancel).toBeGreaterThan(stop);
        expect(kill).toBeGreaterThan(cancel);
        expect(fake.calls[cancel]).toMatchObject({ result: { answers: {} } });
        yield* probe.release;
        const response = yield* Fiber.join(result);
        expect(response.status).toBe(502);
        expect(yield* response.text).toContain("asked for something");
        expect(existsSync(cwd)).toBe(false);
      }).pipe(Effect.ensuring(probe.release));
    }),
  );

  for (const reason of ["timeout", "disconnect"] as const) {
    it.effect("interrupts a running Codex draft on " + reason, () =>
      Effect.gen(function* () {
        const fake = yield* Fake;
        const probe = yield* closeProbe;
        const started = yield* Deferred.make<void>();
        const idea = "Draft without waiting.";
        fake.load(draftFixture("interrupt-mid-stream", idea), "/tmp", {
          holdRequest: (method) => {
            if (method === "turn/start") Deferred.doneUnsafe(started, Effect.void);
            return false;
          },
          beforeClose: probe.beforeClose,
        });
        yield* Effect.gen(function* () {
          const result = yield* Effect.forkChild(draftWithCodex(idea));
          yield* Deferred.await(started);
          if (reason === "timeout") yield* TestClock.adjust("2 minutes");
          else yield* Fiber.interrupt(result);
          const cwd = yield* probe.closing;
          expect(existsSync(cwd)).toBe(true);
          expect(fake.requests("turn/interrupt")).toHaveLength(1);
          yield* probe.release;
          if (reason === "timeout") {
            expect((yield* Fiber.join(result)).status).toBe(502);
            expect(existsSync(cwd)).toBe(false);
          }
        }).pipe(Effect.ensuring(probe.release));
      }),
    );
  }

  it.effect("closes Codex after a bounded wait if the turn start never returns a native ID", () =>
    Effect.gen(function* () {
      const fake = yield* Fake;
      const started = yield* Deferred.make<void>();
      const idea = "Draft without a turn ID.";
      fake.load(draftFixture("multi-turn", idea), "/tmp", {
        holdRequest: (method) => {
          if (method !== "turn/start") return false;
          Deferred.doneUnsafe(started, Effect.void);
          return true;
        },
      });
      const result = yield* Effect.forkChild(draftWithCodex(idea));
      yield* Deferred.await(started);
      yield* TestClock.adjust("2 minutes");
      yield* TestClock.adjust("5 seconds");
      expect((yield* Fiber.join(result)).status).toBe(502);
      expect(fake.requests("turn/interrupt")).toEqual([]);
      expect(fake.calls.at(-1)).toEqual({ call: "kill" });
      expect(existsSync(fake.launches()[0]!.cwd)).toBe(false);
    }),
  );

  for (const stalled of ["initialize", "model/list"] as const) {
    it.effect("closes a cold model lookup stalled in " + stalled + " without cancelling a concurrent lookup", () =>
      Effect.gen(function* () {
        const fake = yield* Fake;
        const probe = yield* closeProbe;
        const blocked = yield* Deferred.make<string>();
        const idea = "Draft with a model.";
        let stalledCwd: string | undefined;
        yield* TestClock.adjust("11 minutes");
        fake.load(draftFixture("multi-turn", idea), "/tmp", {
          holdRequest: (method, { cwd }) => {
            if (method !== stalled || stalledCwd !== undefined) return false;
            stalledCwd = cwd;
            Deferred.doneUnsafe(blocked, Effect.succeed(cwd));
            return true;
          },
          beforeClose: (launch) => launch.cwd === stalledCwd ? probe.beforeClose(launch) : Promise.resolve(),
        });
        yield* Effect.gen(function* () {
          const result = yield* Effect.forkChild(draftWithCodex(idea, "gpt-5.6-luna"));
          const cwd = yield* Deferred.await(blocked);
          const healthy = yield* draftWithCodex(idea, "gpt-5.6-luna").pipe(Effect.flatMap(decode(DraftInstructionsResponse)));
          expect(healthy.instructions).toBe("OK");
          yield* TestClock.adjust("2 minutes");
          expect(yield* probe.closing).toBe(cwd);
          expect(existsSync(cwd)).toBe(true);
          yield* probe.release;
          expect((yield* Fiber.join(result)).status).toBe(502);
          expect(existsSync(cwd)).toBe(false);
          expect(fake.requests("turn/start")).toHaveLength(1);
          const launches = fake.launches().length;
          expect((yield* HttpClient.get("/api/providers/codex/models")).status).toBe(200);
          expect(fake.launches()).toHaveLength(launches);
        }).pipe(Effect.ensuring(probe.release));
      }),
    );
  }
});

layer(App)("Codex provider", (it) => {
  it.effect("drafts with the selected Codex model and the provider default", () =>
    Effect.gen(function* () {
      const fake = yield* Fake;
      const body = { idea: "Draft a reviewer." };
      for (const model of ["gpt-5.6-luna", null] as const) {
        const fixture = loadFixture("multi-turn");
        fake.load({ ...fixture, turns: [{ ...fixture.turns[0]!, prompt: JSON.stringify(body) }] }, "/tmp");
        const response = yield* post("/api/agents/draft-instructions", { ...body, providerInstanceId: "codex", model })
          .pipe(Effect.flatMap(decode(DraftInstructionsResponse)));
        expect(response.instructions).toBe("OK");
        const thread = fake.requests("thread/start")[0]!;
        const turn = fake.requests("turn/start")[0]!;
        expect(thread["model"]).toBe(model ?? undefined);
        expect(turn["model"]).toBe(model ?? undefined);
        expect(String(thread["cwd"])).toContain("wiki-agent-draft-");
        expect(existsSync(String(thread["cwd"]))).toBe(false);
        expect(thread["config"]).not.toHaveProperty(["mcp_servers." + VAULT_SERVER]);
        expect(fake.requests("thread/resume")).toEqual([]);
        expect(fake.calls.at(-1)).toEqual({ call: "kill" });
      }
    }),
  );

  it.effect("keeps two subagents and their results attached to the launching turn after it ends", () =>
    Effect.gen(function* () {
      const { thread, prompts } = yield* setUp("subagents-two");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* events.until(isTag("turn.finished")));
      const seen = yield* events.until((event) => event._tag === "subagent.updated" && event.result?.includes("green tea") === true);
      const done = seen.filter((event) => event._tag === "subagent.updated").filter((event) => event.status === "done");
      expect(done).toHaveLength(2);
      expect(new Set(done.map((event) => event.subagentId)).size).toBe(2);
      expect(done.map((event) => event.result)).toContain("Coffee.md Tea.md");
      expect(textOf(seen)).not.toContain("Coffee.md Tea.md");
      expect((yield* getThread(thread.id)).thread.subagentsActive).toBe(0);
    }),
  );

  it.effect("routes a child patch approval after the parent finishes", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("subagents-approval");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* events.until(isTag("turn.finished")));
      const request = yield* events.request;
      expect(request.subagentId).toBeDefined();
      expect(request.prompt).toMatchObject({ _tag: "approval", title: "Create Notes/Child.md" });
      expect((yield* answer(thread.id, request.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      const after = yield* events.until((event) => (event._tag === "subagent.updated" && event.status === "done") || event._tag === "turn.finished");
      expect(after.at(-1)).toMatchObject({ _tag: "subagent.updated", status: "done" });
      expect(responses(fake)).toEqual([{ decision: "accept" }]);
    }),
  );

  it.effect("interrupts both native child turns when the parent is idle", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("subagents-stop-idle");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      completes(yield* events.until(isTag("turn.finished")));
      expect((yield* interrupt(thread.id)).status).toBe(200);
      const cancelled = (event: ThreadEvent) => event._tag === "subagent.updated" && event.status === "cancelled";
      yield* events.until(cancelled);
      yield* events.until(cancelled);
      const calls = fake.calls.flatMap((call) => call.call === "request" && call.method === "turn/interrupt" ? [call.params] : []);
      expect(calls).toHaveLength(2);
      expect(new Set(calls.map((params) => (params as { threadId: string }).threadId)).size).toBe(2);
    }),
  );

  it.effect("is listed with what it can do, and reports its version and who is signed in", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers.find((provider) => provider.id === "codex")).toEqual({
        id: "codex",
        kind: "codex",
        name: "Codex",
        capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true, compact: true },
      });
      const { status: ready } = yield* HttpClient.get("/api/providers/codex/status").pipe(Effect.flatMap(decode(GetProviderStatusResponse)));
      expect(ready).toEqual({ _tag: "ready", version: "0.166.0", account: "you@example.com (plus)" });
    }),
  );

  it.effect("reads a CSV attached in the thread, outside the vault, in its read-only sandbox without asking, and answers from it", () =>
    Effect.gen(function* () {
      const { thread } = yield* setUp("csv");
      const csv = yield* uploadOk(SALES_CSV.name, SALES_CSV.bytes);
      const events = yield* watch(thread.id);
      yield* sendWithOk(thread.id, CSV_PROMPT, [csv.id]);
      const seen = yield* events.until(isTag("turn.finished"));

      completes(seen);
      expect(seen.map((event) => event._tag)).not.toContain("request.opened");
      expect(seen).toContainEqual(
        expect.objectContaining({ _tag: "tool.called", input: expect.stringMatching(new RegExp(`/${sha256(SALES_CSV.bytes)}/sales\\.csv`)) }),
      );
      expect(textOf(seen)).toContain(SALES_TOTAL);
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

  it.effect("streams a simple turn in one app-server, read-only with the secrets denied, and keeps the Codex thread for the app's thread", () =>
    Effect.gen(function* () {
      const { vault, thread, fake, prompts } = yield* setUp("simple");
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
      // Read-only, as a permission profile that also denies the secret store's files and .env files (it replaces the sandbox mode).
      // Only those that exist: no secret is saved yet, so the store's folder is there but not its key.
      const material = yield* (yield* SecretMaterial).current;
      const paths = material.paths.filter((path) => existsSync(path));
      const names = material.names;
      expect(paths.length).toBeGreaterThan(0);
      expect(material.paths.some((path) => path.endsWith("secrets.key") && !paths.includes(path))).toBe(true);
      expect(started).not.toHaveProperty("sandbox");
      expect(started).toMatchObject({
        approvalPolicy: "on-request",
        developerInstructions: expect.stringContaining("# Wiki-LLM rules"),
        config: {
          web_search: "disabled",
          [`mcp_servers.${VAULT_SERVER}`]: { url: expect.stringMatching(/\/mcp$/), bearer_token_env_var: TOKEN_ENV },
          default_permissions: PERMISSION_PROFILE,
          [`permissions.${PERMISSION_PROFILE}.filesystem`]: Object.fromEntries([[":root", "read"], ...protectedEntries({ paths, names }, [vault.rootPath, realpathSync(vault.rootPath)])]),
        },
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

  it.effect("compacts the same thread with thread/compact/start, reporting the compaction without its unknown cost", () =>
    Effect.gen(function* () {
      const { thread, fake, fixture } = yield* setUp("compact");
      const [first, , last] = fixture.turns;
      completes(yield* playTurn(thread.id, first!.prompt));

      const compacting = yield* watch(thread.id);
      const { turnId } = yield* compactOk(thread.id);
      const seen = yield* compacting.until(isTag("turn.finished"));
      expect(seen.find((event) => event._tag === "context.compaction")).toEqual({ _tag: "context.compaction", turnId, outcome: "completed", trigger: "manual" });
      // Codex's usage update for a compaction has no input or output: unknown, not zero.
      expect(completes(seen).usage).toBeNull();
      expect(fake.requests("thread/compact/start")).toEqual([{ threadId: expect.any(String) }]);

      expect(textOf(yield* playTurn(thread.id, last!.prompt)).toLowerCase()).toContain("kiwi");
      expect(fake.launches()).toHaveLength(1);
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

  it.effect("accepts Codex's own confirmation of a call to the app's MCP server without asking, as the server asks itself", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("mcp-confirmation");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));
      completes(seen);
      expect(seen.filter(isTag("request.opened"))).toEqual([]);
      expect(responses(fake)).toEqual([{ action: "accept", content: {}, _meta: null }]);
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
      // Hidden models aren't offered; a model takes images unless Codex says it only takes text.
      expect(models.models.map(({ id, images }) => ({ id, images }))).toEqual([
        { id: "gpt-6.1-sol", images: true },
        { id: "gpt-5.6-luna", images: true },
        { id: "codex-text", images: false },
      ]);
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
        const setup = { instructions: [], autonomy: fixture.autonomy, projectRoots: null, attachmentFolders: [], protection: { paths: [], names: [] }, vaultTools: null };
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

// Its own app, so no other test has saved a secret yet.
layer(App)("Codex provider, before any secret is saved", (it) => {
  it.effect("leaves the missing key out of the sandbox, and denies it from the turn after you save a secret", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      const keyFile = (yield* (yield* SecretMaterial).current).paths.find((path) => path.endsWith("secrets.key"));
      expect(keyFile).toBeDefined();
      const denied = (params: Record<string, unknown> | undefined) => Object.keys((params?.config as Record<string, Record<string, string>>)[`permissions.${PERMISSION_PROFILE}.filesystem`] ?? {});

      completes(yield* playTurn(thread.id, prompts[0]!));
      expect(existsSync(keyFile!)).toBe(false);
      expect(denied(fake.requests("thread/start")[0])).not.toContain(keyFile);

      yield* setSecret("some-token", "s3cret");
      expect(existsSync(keyFile!)).toBe(true);
      completes(yield* playTurn(thread.id, prompts[1]!));
      // The profile changed, so the next turn starts a new app-server that resumes the thread with the key denied.
      expect(fake.launches()).toHaveLength(2);
      expect(denied(fake.requests("thread/resume")[0])).toContain(keyFile);
    }),
  );
});
