import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import { GetDraftResponse } from "@wiki-agents/contracts/threads/get-draft/response";
import { RequestHandoffResponse } from "@wiki-agents/contracts/threads/request-handoff/response";
import { Effect, Layer, type Scope } from "effect";
import { HttpClient, type HttpClientResponse } from "effect/http";
import { makeHttpApp } from "../../src/app/layers.js";
import { finalReply } from "../../src/features/threads/final-reply.js";
import { HANDOFF_PROMPT } from "../../src/features/threads/handoff-prompt.js";
import { HANDOFF_CUT_OFF } from "../../src/features/threads/thread-actor.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { makeTestApp, TestAgents, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";
import { decode, getThread, interrupt, isTag, newThread, newVault, post, send, sendOk, status, tags, watch } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();

const handoff = (threadId: string, operationId: string = crypto.randomUUID()) => post(`/api/threads/${threadId}/handoff`, { operationId });
const handoffOk = (threadId: string, operationId?: string) => handoff(threadId, operationId).pipe(Effect.flatMap(decode(RequestHandoffResponse)));
const continueThread = (threadId: string, body: unknown) => post(`/api/threads/${threadId}/continue`, body);
const continueOk = (threadId: string, body: unknown) => continueThread(threadId, body).pipe(Effect.flatMap(decode(ContinueThreadResponse)), Effect.map((response) => response.thread));
const draftOf = (threadId: string) => HttpClient.get(`/api/threads/${threadId}/draft`).pipe(Effect.flatMap(decode(GetDraftResponse)), Effect.map((response) => response.draft));
const errorOf = (response: HttpClientResponse.HttpClientResponse) => Effect.map(response.text, (error) => ({ status: response.status, error }));

/** A replay thread with one finished turn, so there is a conversation to hand off. */
const replayThreadWithATurn = Effect.gen(function* () {
  const thread = yield* newThread((yield* newVault).id);
  const events = yield* watch(thread.id);
  yield* sendOk(thread.id, "hello");
  yield* events.until(isTag("turn.finished"));
  return thread;
});

layer(makeTestApp({ providers: provider.registry }))("handoff to a new thread", (it) => {
  it.effect("asks the agent for a handoff as a turn of its own; its reply is the handoff", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const events = yield* watch(thread.id);
      const { turnId, started } = yield* handoffOk(thread.id);
      expect(started).toBe(true);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(seen.at(-1)).toMatchObject({ _tag: "turn.finished", turnId, outcome: "completed", reason: null });
      const after = yield* getThread(thread.id);
      const turnTags = tags(after.events.filter((stored) => stored.event.turnId === turnId));
      expect([...new Set(turnTags)]).toEqual(["handoff.requested", "turn.started", "message.delta", "turn.finished"]);
      const reply = finalReply(after.events.map((stored) => stored.event), turnId);
      expect(reply).toMatch(/^## Objective\n/);
      expect(reply).toContain("## Unfinished work");
      // A handoff neither names the thread nor shows the prompt as your message.
      expect(after.thread.title).toBe("hello");
      expect(after.events.some((stored) => stored.event._tag === "user.message" && stored.event.text === HANDOFF_PROMPT)).toBe(false);
    }),
  );

  it.effect("sends the agent the handoff prompt in the thread's own session", () =>
    Effect.gen(function* () {
      provider.scripts.set("*", ({ turnId }) => Effect.succeed([{ _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null }]));
      const thread = yield* newThread((yield* newVault).id, "scripted");
      const events = yield* watch(thread.id);
      const first = yield* sendOk(thread.id, "hello");
      yield* events.until(isTag("turn.finished"));
      const handing = yield* watch(thread.id);
      const { turnId } = yield* handoffOk(thread.id);
      yield* handing.until(isTag("turn.finished"));
      const sent = provider.inputs.filter((input) => input.turnId === first || input.turnId === turnId).map((input) => input.text);
      expect(sent).toEqual(["hello", HANDOFF_PROMPT]);
      // One session for both: the handoff is written by the conversation it summarises.
      expect(provider.sessions.filter((session) => session.threadId === thread.id)).toHaveLength(1);
    }),
  );

  it.effect("refuses before there is a conversation, while a turn runs, and for another turn's id", () =>
    Effect.gen(function* () {
      const fresh = yield* newThread((yield* newVault).id);
      expect(yield* errorOf(yield* handoff(fresh.id))).toEqual({ status: 409, error: "There's no conversation to hand off yet." });
      expect((yield* getThread(fresh.id)).events).toEqual([]);

      const thread = yield* replayThreadWithATurn;
      const messageTurn = (yield* getThread(thread.id)).events[0]!.event.turnId;
      expect(yield* errorOf(yield* handoff(thread.id, messageTurn))).toEqual({ status: 409, error: "That operation id is already used by another turn." });
      expect((yield* handoff(thread.id, "not valid!")).status).toBe(400);
      expect((yield* handoff("no-such-thread")).status).toBe(404);

      const running = yield* watch(thread.id);
      yield* sendOk(thread.id, "a long essay please");
      yield* running.until(isTag("message.delta"), "100 millis");
      expect(yield* errorOf(yield* handoff(thread.id))).toEqual({ status: 409, error: "A turn is running or waiting for you" });
      yield* running.until(isTag("turn.finished"));
    }),
  );

  it.effect("asks once per operation id, refuses messages while it runs, and stops like a turn", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const operationId = crypto.randomUUID();
      expect(yield* handoffOk(thread.id, operationId)).toEqual({ turnId: operationId, started: true });
      expect(yield* handoffOk(thread.id, operationId)).toEqual({ turnId: operationId, started: false });
      expect(yield* status(thread.id)).toBe("running");
      expect((yield* send(thread.id, "are you done?")).status).toBe(409);
      const events = yield* watch(thread.id);
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect((yield* events.until(isTag("turn.finished"))).at(-1)).toEqual({ _tag: "turn.finished", turnId: operationId, outcome: "interrupted", usage: null, reason: null });
      expect(tags((yield* getThread(thread.id)).events).filter((tag) => tag === "handoff.requested")).toHaveLength(1);
    }),
  );

  it.effect("continues in a new thread with a fresh session, the same setup, and the handoff as its draft", () =>
    Effect.gen(function* () {
      provider.scripts.set("*", ({ turnId }) => Effect.succeed([{ _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null }]));
      const vault = yield* newVault;
      const source = yield* post(`/api/vaults/${vault.id}/threads`, { providerInstanceId: "scripted", agentId: "researcher" }).pipe(
        Effect.flatMap(decode(ContinueThreadResponse)),
        Effect.map((response) => response.thread),
      );
      const events = yield* watch(source.id);
      yield* sendOk(source.id, "Plan the import");
      yield* events.until(isTag("turn.finished"));
      const sourceDraft = yield* draftOf(source.id);

      const text = "## Objective\nImport the notes.\n\n## Unfinished work\nRun the import.";
      const next = yield* continueOk(source.id, { text });
      expect(next).toMatchObject({
        vaultId: vault.id,
        projectId: null,
        providerInstanceId: "scripted",
        agentId: "researcher",
        model: source.model,
        title: "Continued: Plan the import",
        status: "idle",
        lastTurn: null,
        continuedFrom: source.id,
        continuedIn: null,
        lastSeq: 0,
      });
      expect(next.id).not.toBe(source.id);
      // Nothing is sent: the handoff waits in the composer.
      expect((yield* getThread(next.id)).events).toEqual([]);
      expect((yield* draftOf(next.id)).text).toBe(text);
      // The source is left as it was, and links to the new thread.
      const after = yield* getThread(source.id);
      expect(after.thread).toMatchObject({ continuedFrom: null, continuedIn: next.id, doneAt: null, title: "Plan the import" });
      expect(yield* draftOf(source.id)).toEqual(sourceDraft);

      // Its first turn opens a session of its own, not the source's.
      const nextEvents = yield* watch(next.id);
      yield* sendOk(next.id, text);
      yield* nextEvents.until(isTag("turn.finished"));
      const sessions = provider.sessions.filter((session) => session.threadId === next.id);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.nativeSessionId).toBeNull();
      // The draft went with the message; the title stays the continued one.
      expect((yield* draftOf(next.id)).text).toBe("");
      expect((yield* getThread(next.id)).thread.title).toBe("Continued: Plan the import");
    }),
  );

  it.effect("refuses an empty handoff, other folders outside a project, and unknown threads", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      expect((yield* continueThread(thread.id, { text: "" })).status).toBe(400);
      expect(yield* errorOf(yield* continueThread(thread.id, { text: "x", workspace: "main" }))).toEqual({
        status: 409,
        error: "Only a thread in a project can choose where the new thread works.",
      });
      expect((yield* continueThread("no-such-thread", { text: "x" })).status).toBe(404);
      expect((yield* getThread(thread.id)).thread.continuedIn).toBeNull();
    }),
  );
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const appOn = (file: string) =>
  makeHttpApp({ vaults: [], watch: false, providers: provider.registry, agents: TestAgents, attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
const run = <A, E>(file: string, body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof appOn>> | Scope.Scope>) => Effect.scoped(Effect.provide(body, appOn(file)));
const tempDatabase = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-handoff-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
).pipe(Effect.map((dir) => join(dir, "app.db")));

describe("handoff across a restart", () => {
  it.effect("never continues a handoff the server stopped during", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const { threadId, turnId } = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* replayThreadWithATurn;
          // Replay answers after a pause the test clock never reaches.
          const { turnId } = yield* handoffOk(thread.id);
          return { threadId: thread.id, turnId };
        }),
      );
      const after = yield* run(
        file,
        Effect.gen(function* () {
          yield* (yield* ThreadActors).wake(threadId);
          return yield* getThread(threadId);
        }),
      );
      expect(after.events.at(-1)?.event).toEqual({ _tag: "turn.finished", turnId, outcome: "interrupted", usage: null, reason: HANDOFF_CUT_OFF });
      expect(after.thread.status).toBe("idle");
    }),
  );
});
