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
  | { readonly call: "reply"; readonly requestId: string; readonly reply: string; readonly message?: string }
  | { readonly call: "switchModel"; readonly model: string };

interface Loaded {
  readonly fixture: Fixture;
  readonly directory: string;
  readonly options: PlayOptions;
  turn: number;
}

/**
 * An OpenCode server that plays a recorded fixture: each prompt plays the next
 * recorded turn's events, pausing at a request until the adapter answers it (with
 * the answer that was recorded) and at a recorded Stop until the adapter presses it.
 * `load` switches fixtures between tests; the API object stays the same, as the
 * adapter keeps it for the server's lifetime.
 */
export const makeFakeOpenCode = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const hub = yield* PubSub.unbounded<OpenCodeSignal>();
  const calls: Array<FakeCall> = [];
  let loaded: Loaded | undefined;
  let running = false;
  let outcome: OpenCodeOutcome | null = null;
  let playback: Fiber.Fiber<void> | undefined;
  const replies = new Map<string, Deferred.Deferred<string>>();
  let stopPressed: Deferred.Deferred<void> | undefined;
  let startGate: Deferred.Deferred<void> | undefined;
  /** Done once the adapter has sent the loaded fixture's next prompt. */
  let prompted = yield* Deferred.make<void>();

  const current = () => {
    if (loaded === undefined) throw new Error("no fixture loaded");
    return loaded;
  };

  const replyFor = Effect.fnUntraced(function* (requestId: string) {
    const existing = replies.get(requestId);
    if (existing !== undefined) return existing;
    const created = yield* Deferred.make<string>();
    replies.set(requestId, created);
    return created;
  });

  /** Loads so far; request ids get it as a suffix, as a real OpenCode never repeats one. */
  let loads = 0;
  const requestIds = (text: string) => text.replace(/\b(per|frm)_[A-Za-z0-9]+/g, (id) => `${id}x${loads}`);
  const toEvent = (raw: unknown) =>
    decodeEvent(JSON.parse(requestIds(JSON.stringify(raw)).replaceAll(VAULT, current().directory)));

  const play = (steps: ReadonlyArray<FixtureStep>) =>
    Effect.gen(function* () {
      const { options } = current();
      let published = 0;
      for (const [index, step] of steps.entries()) {
        if ("call" in step) {
          if (step.call === "interrupt") yield* Deferred.await(stopPressed ?? (yield* Deferred.make<void>()));
          continue;
        }
        const event = toEvent(step.event);
        if (event.type === "session.execution.started" && startGate !== undefined) yield* Deferred.await(startGate);
        if (event.type === "session.execution.started") running = true;
        if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
          running = false;
          outcome = event.type === "session.execution.succeeded" ? "succeeded" : event.type === "session.execution.failed" ? "failed" : "interrupted";
        }
        if (options.loseAfter === undefined || published < options.loseAfter) {
          yield* PubSub.publish(hub, { _tag: "event", event });
          published++;
        }
        const requestId = event.type === "permission.asked" ? event.data.id : event.type === "form.created" ? event.data.form.id : undefined;
        if (requestId !== undefined) {
          const recorded = steps
            .slice(index + 1)
            .find((next) => "call" in next && next.call === "reply" && requestIds(next.requestId) === requestId);
          const answer = yield* Deferred.await(yield* replyFor(requestId));
          if (recorded !== undefined && "reply" in recorded && recorded.reply !== answer) {
            return yield* Effect.die(new Error(`fixture answered ${requestId} with ${recorded.reply}, the adapter with ${answer}`));
          }
        }
      }
    });

  const api: OpenCodeApi = {
    get version() {
      return loaded?.fixture.opencodeVersion ?? "2.2.1";
    },
    subscribe: PubSub.subscribe(hub),
    createSession: ({ model, permissions }) =>
      Effect.sync(() => {
        calls.push({ call: "createSession", model, permissions });
        return current().fixture.sessionId;
      }),
    setPermissions: (_sessionId, permissions) =>
      Effect.sync(() => {
        calls.push({ call: "setPermissions", permissions });
      }),
    sessionExists: (sessionId) => Effect.sync(() => loaded?.fixture.sessionId === sessionId),
    prompt: (_sessionId, text) =>
      Effect.gen(function* () {
        calls.push({ call: "prompt", text });
        const state = current();
        const turn = state.fixture.turns[state.turn++];
        if (turn === undefined) return yield* Effect.die(new Error(`fixture ${state.fixture.scenario} has no turn ${state.turn}`));
        if (turn.prompt !== text) return yield* Effect.die(new Error(`fixture prompt was "${turn.prompt}", the adapter sent "${text}"`));
        stopPressed = yield* Deferred.make<void>();
        startGate = state.options.holdStart === true ? yield* Deferred.make<void>() : undefined;
        running = state.options.holdStart !== true;
        playback = yield* play(turn.steps).pipe(Effect.forkIn(scope));
        yield* Deferred.succeed(prompted, undefined);
        const enqueued = turn.steps.map((step) => ("event" in step ? toEvent(step.event) : undefined)).find((event) => event?.type === "session.inbox.enqueued");
        return enqueued?.type === "session.inbox.enqueued" ? (enqueued.data.inboxID as string) : "msg_fake";
      }),
    // Withdrawing works while the turn is held before it starts; once OpenCode has
    // taken the message it still says yes, and the turn runs anyway (as recorded).
    cancelPrompt: () =>
      Effect.gen(function* () {
        calls.push({ call: "cancelPrompt" });
        if (startGate !== undefined && !(yield* Deferred.isDone(startGate)) && playback !== undefined) {
          yield* Fiber.interrupt(playback);
        }
      }),
    interrupt: () =>
      Effect.gen(function* () {
        calls.push({ call: "interrupt" });
        if (stopPressed === undefined || !running) return false;
        yield* Deferred.succeed(stopPressed, undefined);
        return true;
      }),
    isRunning: () => Effect.sync(() => running),
    lastOutcome: () => Effect.sync(() => outcome),
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
    defaultModel: () => Effect.sync(() => loaded?.fixture.model ?? null),
    switchModel: (_sessionId, model) =>
      Effect.sync(() => {
        calls.push({ call: "switchModel", model });
      }),
  };

  return {
    api,
    calls,
    /** Plays `fixture` from its first turn, with recorded paths moved to `directory`. */
    load: (fixture: Fixture, directory: string, options: PlayOptions = {}) =>
      Effect.gen(function* () {
        if (playback !== undefined) yield* Fiber.interrupt(playback);
        loaded = { fixture, directory, options, turn: 0 };
        loads++;
        calls.length = 0;
        running = false;
        outcome = null;
        replies.clear();
        playback = undefined;
        prompted = yield* Deferred.make<void>();
      }),
    /**
     * Waits for the adapter to send the prompt (it subscribes to events before that),
     * then for the turn's recording to play to its end, or to be withdrawn.
     */
    played: Effect.suspend(() => Deferred.await(prompted)).pipe(
      Effect.andThen(Effect.suspend(() => (playback === undefined ? Effect.void : Effect.asVoid(Fiber.await(playback))))),
    ),
    /** Lets a turn held by `holdStart` start. */
    release: Effect.suspend(() => (startGate === undefined ? Effect.void : Deferred.succeed(startGate, undefined))),
    /** As if the event stream dropped and came back. */
    reconnect: PubSub.publish(hub, { _tag: "reconnected" }),
  };
});

export type FakeOpenCode = Effect.Success<typeof makeFakeOpenCode>;
