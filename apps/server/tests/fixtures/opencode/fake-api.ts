import { readFileSync } from "node:fs";
import { OpenCodeEvent } from "@opencode/protocol/groups/event";
import { Deferred, Effect, Fiber, PubSub, Schema } from "effect";
import type { OpenCodeApi, OpenCodeModel, OpenCodeOutcome, OpenCodePermissionRule, OpenCodeSignal } from "../../../src/features/providers/opencode/api.js";
import { type Fixture, type FixtureStep, VAULT } from "./fixture.js";

const decodeEvent = Schema.decodeUnknownSync(OpenCodeEvent);

export const loadFixture = (scenario: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./${scenario}.json`, import.meta.url), "utf8")) as Fixture;

export const FAKE_MODELS: ReadonlyArray<OpenCodeModel> = [
  { id: "opencode/big-pickle", name: "Big Pickle", free: true },
  { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5", free: false },
];

export interface PlayOptions {
  /** Hold the turn before OpenCode starts it, until `release` (to press Stop in between). */
  readonly holdStart?: boolean;
  /** Stop publishing after this many events, as if the stream lost the rest; the turn still runs to its end. */
  readonly loseAfter?: number;
}

/** What the adapter asked of OpenCode, in order. */
export type FakeCall =
  | { readonly call: "createSession"; readonly model: string | null; readonly permissions: ReadonlyArray<OpenCodePermissionRule> }
  | { readonly call: "prompt"; readonly text: string }
  | { readonly call: "cancelPrompt" | "interrupt" }
  | { readonly call: "setPermissions"; readonly permissions: ReadonlyArray<OpenCodePermissionRule> }
  | { readonly call: "setInstructions"; readonly text: string | null }
  | { readonly call: "reply"; readonly requestId: string; readonly reply: string; readonly message?: string }
  | { readonly call: "switchModel"; readonly model: string };

/** One recorded conversation being played, as one OpenCode session. */
interface Session {
  readonly fixture: Fixture;
  readonly directory: string;
  readonly options: PlayOptions;
  /** Request ids get this suffix, as a real OpenCode never repeats one. */
  readonly suffix: string;
  created: boolean;
  turn: number;
  running: boolean;
  outcome: OpenCodeOutcome | null;
  playback: Fiber.Fiber<void> | undefined;
  stopPressed: Deferred.Deferred<void> | undefined;
  startGate: Deferred.Deferred<void> | undefined;
  /** Done once the adapter has sent this session's next prompt. */
  prompted: Deferred.Deferred<void>;
}

/**
 * An OpenCode server that plays recorded fixtures, one per session: each prompt
 * plays the session's next recorded turn, pausing at a request until the adapter
 * answers it (with the answer that was recorded) and at a recorded Stop until the
 * adapter presses it. `load` starts over with one fixture between tests, `add`
 * plays another at the same time; `createSession` hands them out in that order.
 * The API object stays the same, as the adapter keeps it for the server's lifetime.
 */
export const makeFakeOpenCode = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const hub = yield* PubSub.unbounded<OpenCodeSignal>();
  const calls: Array<FakeCall> = [];
  const sessions = new Map<string, Session>();
  /** The server crashed (`crash`) and hasn't been started again. */
  let stopped = false;
  let starts = 0;
  let loads = 0;
  const replies = new Map<string, Deferred.Deferred<string>>();

  const sessionFor = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session === undefined) throw new Error(`no fixture loaded for session ${sessionId}`);
    return session;
  };

  const replyFor = Effect.fnUntraced(function* (requestId: string) {
    const existing = replies.get(requestId);
    if (existing !== undefined) return existing;
    const created = yield* Deferred.make<string>();
    replies.set(requestId, created);
    return created;
  });

  const requestIds = (session: Session, text: string) => text.replace(/\b(per|frm)_[A-Za-z0-9]+/g, (id) => `${id}${session.suffix}`);
  const toEvent = (session: Session, raw: unknown) =>
    decodeEvent(JSON.parse(requestIds(session, JSON.stringify(raw)).replaceAll(VAULT, session.directory)));

  const play = (session: Session, steps: ReadonlyArray<FixtureStep>) =>
    Effect.gen(function* () {
      let published = 0;
      for (const [index, step] of steps.entries()) {
        if ("call" in step) {
          if (step.call === "interrupt") yield* Deferred.await(session.stopPressed ?? (yield* Deferred.make<void>()));
          continue;
        }
        const event = toEvent(session, step.event);
        if (event.type === "session.execution.started" && session.startGate !== undefined) yield* Deferred.await(session.startGate);
        if (event.type === "session.execution.started") session.running = true;
        if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
          session.running = false;
          session.outcome =
            event.type === "session.execution.succeeded" ? "succeeded" : event.type === "session.execution.failed" ? "failed" : "interrupted";
        }
        if (session.options.loseAfter === undefined || published < session.options.loseAfter) {
          yield* PubSub.publish(hub, { _tag: "event", event });
          published++;
        }
        const requestId = event.type === "permission.asked" ? event.data.id : event.type === "form.created" ? event.data.form.id : undefined;
        if (requestId !== undefined) {
          const recorded = steps
            .slice(index + 1)
            .find((next) => "call" in next && next.call === "reply" && requestIds(session, next.requestId) === requestId);
          const answer = yield* Deferred.await(yield* replyFor(requestId));
          if (recorded !== undefined && "reply" in recorded && recorded.reply !== answer) {
            return yield* Effect.die(new Error(`fixture answered ${requestId} with ${recorded.reply}, the adapter with ${answer}`));
          }
        }
      }
    });

  const stopPlayback = (session: Session) => (session.playback === undefined ? Effect.void : Fiber.interrupt(session.playback));

  const api: OpenCodeApi = {
    get version() {
      return [...sessions.values()][0]?.fixture.opencodeVersion ?? "2.2.1";
    },
    isStopped: Effect.sync(() => stopped),
    subscribe: PubSub.subscribe(hub),
    createSession: ({ model, permissions }) =>
      Effect.sync(() => {
        calls.push({ call: "createSession", model, permissions });
        const next = [...sessions.values()].find((session) => !session.created);
        if (next === undefined) throw new Error("no fixture left for a new session");
        next.created = true;
        return next.fixture.sessionId;
      }),
    setPermissions: (_sessionId, permissions) =>
      Effect.sync(() => {
        calls.push({ call: "setPermissions", permissions });
      }),
    setInstructions: (_sessionId, text) =>
      Effect.sync(() => {
        calls.push({ call: "setInstructions", text });
      }),
    sessionExists: (sessionId) => Effect.sync(() => sessions.has(sessionId)),
    prompt: (sessionId, text) =>
      Effect.gen(function* () {
        calls.push({ call: "prompt", text });
        const session = sessionFor(sessionId);
        const turn = session.fixture.turns[session.turn++];
        if (turn === undefined) return yield* Effect.die(new Error(`fixture ${session.fixture.scenario} has no turn ${session.turn}`));
        if (turn.prompt !== text) return yield* Effect.die(new Error(`fixture prompt was "${turn.prompt}", the adapter sent "${text}"`));
        session.stopPressed = yield* Deferred.make<void>();
        session.startGate = session.options.holdStart === true ? yield* Deferred.make<void>() : undefined;
        session.running = session.options.holdStart !== true;
        session.playback = yield* play(session, turn.steps).pipe(Effect.forkIn(scope));
        yield* Deferred.succeed(session.prompted, undefined);
        const enqueued = turn.steps
          .map((step) => ("event" in step ? toEvent(session, step.event) : undefined))
          .find((event) => event?.type === "session.inbox.enqueued");
        return enqueued?.type === "session.inbox.enqueued" ? (enqueued.data.inboxID as string) : "msg_fake";
      }),
    // Withdrawing works while the turn is held before it starts; once OpenCode has
    // taken the message it still says yes, and the turn runs anyway (as recorded).
    cancelPrompt: (sessionId) =>
      Effect.gen(function* () {
        calls.push({ call: "cancelPrompt" });
        const session = sessionFor(sessionId);
        if (session.startGate !== undefined && !(yield* Deferred.isDone(session.startGate))) yield* stopPlayback(session);
      }),
    interrupt: (sessionId) =>
      Effect.gen(function* () {
        calls.push({ call: "interrupt" });
        const session = sessionFor(sessionId);
        if (session.stopPressed === undefined || !session.running) return false;
        yield* Deferred.succeed(session.stopPressed, undefined);
        return true;
      }),
    isRunning: (sessionId) => Effect.sync(() => sessions.get(sessionId)?.running ?? false),
    lastOutcome: (sessionId) => Effect.sync(() => sessions.get(sessionId)?.outcome ?? null),
    replyPermission: (_sessionId, requestId, reply, message) =>
      Effect.gen(function* () {
        calls.push({ call: "reply", requestId, reply, ...(message === undefined ? {} : { message }) });
        yield* Deferred.succeed(yield* replyFor(requestId), reply);
      }),
    replyForm: (_sessionId, formId, answer) =>
      Effect.gen(function* () {
        const text = Object.values(answer)[0] ?? "";
        calls.push({ call: "reply", requestId: formId, reply: text });
        yield* Deferred.succeed(yield* replyFor(formId), text);
      }),
    listModels: () => Effect.succeed(FAKE_MODELS),
    defaultModel: () => Effect.sync(() => [...sessions.values()][0]?.fixture.model ?? null),
    switchModel: (_sessionId, model) =>
      Effect.sync(() => {
        calls.push({ call: "switchModel", model });
      }),
  };

  const add = (fixture: Fixture, directory: string, options: PlayOptions = {}) =>
    Effect.gen(function* () {
      const existing = sessions.get(fixture.sessionId);
      if (existing !== undefined) yield* stopPlayback(existing);
      sessions.set(fixture.sessionId, {
        fixture,
        directory,
        options,
        suffix: `x${++loads}`,
        created: false,
        turn: 0,
        running: false,
        outcome: null,
        playback: undefined,
        stopPressed: undefined,
        startGate: undefined,
        prompted: yield* Deferred.make<void>(),
      });
    });

  return {
    api,
    calls,
    /** Starts the server (the adapter's `start`); counted, and undoes a crash. */
    start: Effect.sync(() => {
      stopped = false;
      starts++;
      return api;
    }),
    starts: () => starts,
    /** As if the OpenCode process died: every turn, approval, and question goes with it. */
    crash: Effect.gen(function* () {
      stopped = true;
      for (const session of sessions.values()) {
        session.running = false;
        yield* stopPlayback(session);
      }
      yield* PubSub.publish(hub, { _tag: "stopped" });
    }),
    /** Starts over with `fixture` alone, with recorded paths moved to `directory`. */
    load: (fixture: Fixture, directory: string, options: PlayOptions = {}) =>
      Effect.gen(function* () {
        for (const session of sessions.values()) yield* stopPlayback(session);
        sessions.clear();
        calls.length = 0;
        replies.clear();
        yield* add(fixture, directory, options);
      }),
    /** Plays another fixture at the same time, in a session of its own. */
    add,
    /**
     * Waits for the adapter to send each session's prompt (it subscribes to events
     * before that), then for each turn's recording to play to its end, or to be withdrawn.
     */
    played: Effect.suspend(() =>
      Effect.forEach(
        [...sessions.values()],
        (session) =>
          Deferred.await(session.prompted).pipe(
            Effect.andThen(Effect.suspend(() => (session.playback === undefined ? Effect.void : Effect.asVoid(Fiber.await(session.playback))))),
          ),
        { discard: true },
      ),
    ),
    /** Lets turns held by `holdStart` start. */
    release: Effect.suspend(() =>
      Effect.forEach([...sessions.values()], (session) => (session.startGate === undefined ? Effect.void : Deferred.succeed(session.startGate, undefined)), {
        discard: true,
      }),
    ),
    /** As if the event stream dropped and came back. */
    reconnect: PubSub.publish(hub, { _tag: "reconnected" }),
  };
});

export type FakeOpenCode = Effect.Success<typeof makeFakeOpenCode>;
