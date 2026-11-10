import { randomUUID } from "node:crypto";
import type { RequestAnswer, ThreadEvent, ThreadSummary, TurnOutcome, TurnUsage } from "@wiki-agents/contracts/threads/model";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Queue, Scope, Stream } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import { ProviderError, type ProviderEvent, type ProviderSession } from "../providers/port.js";
import { ProviderRegistry } from "../providers/registry.js";
import { findVault } from "../vaults/find-vault.js";
import { NoTurnRunning, RequestClosed, RequestNotFound, ThreadBusy, ThreadNotFound, WrongAnswerKind } from "./errors.js";
import { type PendingRequest, ThreadRepository } from "./repository.js";
import { ThreadBus } from "./thread-bus.js";

/** Messages a ThreadActor handles, one at a time, in the order they arrive. */
type Message =
  | { readonly _tag: "Resume" }
  | { readonly _tag: "SendMessage"; readonly text: string; readonly reply: Deferred.Deferred<string, ThreadBusy | DbError> }
  | { readonly _tag: "Interrupt"; readonly reply: Deferred.Deferred<string, NoTurnRunning | DbError> }
  | {
      readonly _tag: "AnswerRequest";
      readonly requestId: string;
      readonly answer: RequestAnswer;
      readonly reply: Deferred.Deferred<void, AnswerError>;
    }
  | { readonly _tag: "SetModel"; readonly model: string; readonly reply: Deferred.Deferred<ThreadSummary, DbError | ProviderError> }
  /** From the turn's provider fiber; ignored once that turn is over. */
  | { readonly _tag: "ProviderEvent"; readonly turnId: string; readonly event: ProviderEvent }
  | { readonly _tag: "ProviderEnded"; readonly turnId: string; readonly exit: Exit.Exit<void, ProviderError> };

export type AnswerError = RequestNotFound | RequestClosed | WrongAnswerKind | DbError;

export interface ThreadActor {
  /** Starts a turn and returns its id once the provider has it. */
  readonly sendMessage: (text: string) => Effect.Effect<string, ThreadBusy | DbError>;
  /** Stops the running turn; returns its id. */
  readonly interrupt: Effect.Effect<string, NoTurnRunning | DbError>;
  readonly answerRequest: (requestId: string, answer: RequestAnswer) => Effect.Effect<void, AnswerError>;
  /** Saves the thread's model and tells an open provider session to use it from the next turn. */
  readonly setModel: (model: string) => Effect.Effect<ThreadSummary, DbError | ProviderError>;
}

interface RunningTurn {
  readonly id: string;
  fiber: Fiber.Fiber<void> | undefined;
  /** Keeps the actor alive while the turn runs (see `retain`). */
  hold: Scope.Closeable | undefined;
}

/** Events that can change a thread's status or title, so the thread list hears about them. */
const LIST_EVENTS = new Set<ThreadEvent["_tag"]>(["user.message", "request.opened", "request.resolved", "turn.finished"]);

export const SERVER_STOPPED = "The server stopped during this turn.";

/**
 * The ThreadActor: one mailbox and one fiber per thread, so a send, an interrupt,
 * and provider events never race. SQLite is the record and is written before
 * anything is published; the actor's own state (the running turn, pending requests)
 * is rebuilt from it by the `Resume` message it handles first.
 *
 * `retain` takes a reference on the actor in the given scope, so an idle timeout
 * can't stop it while a turn runs or waits for an answer.
 */
export const makeThreadActor = Effect.fnUntraced(function* (
  threadId: string,
  retain: Effect.Effect<void, never, Scope.Scope>,
) {
  const repository = yield* ThreadRepository;
  const bus = yield* ThreadBus;
  const thread = Option.getOrUndefined(yield* repository.find(threadId));
  if (thread === undefined) return yield* new ThreadNotFound({ threadId });
  const vault = yield* findVault(thread.vaultId);
  const { adapter } = yield* (yield* ProviderRegistry).get(thread.providerInstanceId);
  const actorScope = yield* Effect.scope;
  const mailbox = yield* Queue.unbounded<Message>();

  let session: ProviderSession | undefined;
  let turn: RunningTurn | undefined;
  const pending = new Map<string, PendingRequest>();

  /** Opens the provider session on first use, continuing the thread's earlier one if the provider still has it. */
  const openSession = Effect.gen(function* () {
    if (session !== undefined) return session;
    const stored = yield* repository.providerSession(threadId);
    const opened = yield* adapter
      .openSession({ threadId, cwd: vault.rootPath, nativeSessionId: stored.nativeSessionId, model: stored.model })
      .pipe(Scope.provide(actorScope));
    if (opened.nativeSessionId !== stored.nativeSessionId) {
      yield* repository.setNativeSession(threadId, opened.nativeSessionId).pipe(
        Effect.mapError((cause) => new ProviderError({ message: "Couldn't save the provider's session.", cause })),
      );
    }
    session = opened;
    return opened;
  });

  const record = Effect.fnUntraced(function* (events: ReadonlyArray<ThreadEvent>, options?: { readonly startTurn?: string }) {
    const stored = yield* repository.append(threadId, events, yield* Clock.currentTimeMillis, options);
    yield* bus.publishEvents(stored);
    if (events.some((event) => LIST_EVENTS.has(event._tag))) {
      const summary = yield* repository.find(threadId);
      if (Option.isSome(summary)) yield* bus.publishThread(summary.value);
    }
  });

  /** Reads the provider's events into the mailbox, from a fiber the actor can stop. */
  const run = Effect.fnUntraced(function* (current: RunningTurn, events: Stream.Stream<ProviderEvent, ProviderError>) {
    current.hold = yield* Scope.make();
    yield* retain.pipe(Scope.provide(current.hold));
    current.fiber = yield* events.pipe(
      Stream.runForEach((event) => Queue.offer(mailbox, { _tag: "ProviderEvent", turnId: current.id, event })),
      Effect.exit,
      Effect.flatMap((exit) => Queue.offer(mailbox, { _tag: "ProviderEnded", turnId: current.id, exit })),
      Effect.asVoid,
      Effect.forkIn(actorScope),
    );
  });

  const finish = Effect.fnUntraced(function* (outcome: TurnOutcome, usage: TurnUsage | null, reason: string | null) {
    const current = turn;
    if (current === undefined) return;
    const cancelled = [...pending.values()]
      .filter((request) => request.turnId === current.id)
      .map((request): ThreadEvent => ({ _tag: "request.resolved", turnId: current.id, requestId: request.requestId, answer: null }));
    yield* record([...cancelled, { _tag: "turn.finished", turnId: current.id, outcome, usage, reason }]);
    pending.clear();
    turn = undefined;
    if (current.fiber !== undefined) yield* Fiber.interrupt(current.fiber);
    if (current.hold !== undefined) yield* Scope.close(current.hold, Exit.void);
  });

  /** Starts a provider turn for a turn already recorded, then drops its outbox row. */
  const dispatch = Effect.fnUntraced(function* (current: RunningTurn, text: string) {
    const opened = yield* Effect.result(openSession);
    if (opened._tag === "Failure") return yield* finish("failed", null, opened.failure.message);
    yield* run(current, opened.success.startTurn({ turnId: current.id, text }));
    yield* repository.markDispatched(current.id);
  });

  const resume = Effect.gen(function* () {
    const recovery = yield* repository.recovery(threadId);
    for (const request of recovery.pendingRequests) pending.set(request.requestId, request);
    if (Option.isNone(recovery.openTurn)) return;
    const open = recovery.openTurn.value;
    const current: RunningTurn = { id: open.id, fiber: undefined, hold: undefined };
    turn = current;
    if (!open.dispatched) return yield* dispatch(current, open.input);
    const resumed = adapter.capabilities.resume
      ? yield* Effect.flatMap(openSession, (session) =>
          session.resumeTurn({
            turnId: open.id,
            text: open.input,
            pendingRequestIds: recovery.pendingRequests.filter((request) => request.turnId === open.id).map((request) => request.requestId),
          }),
        ).pipe(Effect.catch(() => Effect.succeed(Option.none())))
      : Option.none();
    if (Option.isNone(resumed)) return yield* finish("interrupted", null, SERVER_STOPPED);
    yield* run(current, resumed.value);
  });

  const sendMessage = Effect.fnUntraced(function* (text: string) {
    if (turn !== undefined) return yield* new ThreadBusy({ threadId });
    const current: RunningTurn = { id: randomUUID(), fiber: undefined, hold: undefined };
    yield* record(
      [
        { _tag: "user.message", turnId: current.id, text },
        { _tag: "turn.started", turnId: current.id },
      ],
      { startTurn: current.id },
    );
    turn = current;
    yield* dispatch(current, text);
    return current.id;
  });

  const interrupt = Effect.gen(function* () {
    const current = turn;
    if (current === undefined) return yield* new NoTurnRunning({ threadId });
    if (session !== undefined) yield* session.interrupt(current.id);
    yield* finish("interrupted", null, null);
    return current.id;
  });

  const answerRequest = Effect.fnUntraced(function* (requestId: string, answer: RequestAnswer) {
    const request = pending.get(requestId);
    if (request === undefined) {
      const stored = yield* repository.findRequest(threadId, requestId);
      if (Option.isNone(stored) || stored.value.status === "pending") return yield* new RequestNotFound({ requestId });
      return yield* new RequestClosed({ requestId, status: stored.value.status });
    }
    if (request.prompt._tag !== answer._tag) return yield* new WrongAnswerKind({ requestId });
    yield* record([{ _tag: "request.resolved", turnId: request.turnId, requestId, answer }]);
    pending.delete(requestId);
    const answered = yield* Effect.result(Effect.flatMap(openSession, (session) => session.answerRequest(requestId, answer)));
    if (answered._tag === "Failure") yield* finish("failed", null, answered.failure.message);
  });

  const setModel = Effect.fnUntraced(function* (model: string) {
    const summary = yield* repository.setModel(threadId, model, yield* Clock.currentTimeMillis);
    if (session !== undefined) yield* session.setModel(model);
    yield* bus.publishThread(summary);
    return summary;
  });

  const onProviderEvent = Effect.fnUntraced(function* (event: ProviderEvent) {
    switch (event._tag) {
      case "turn.finished":
        return yield* finish(event.outcome, event.usage, event.reason);
      case "request.opened":
        yield* record([event]);
        pending.set(event.requestId, { requestId: event.requestId, turnId: event.turnId, prompt: event.prompt });
        return;
      default:
        return yield* record([event]);
    }
  });

  const onProviderEnded = (exit: Exit.Exit<void, ProviderError>) => {
    if (Exit.isSuccess(exit)) return finish("completed", null, null);
    const failure = Cause.findErrorOption(exit.cause);
    return finish("failed", null, Option.isSome(failure) ? failure.value.message : "The provider stopped unexpectedly.");
  };

  const handle = (message: Message): Effect.Effect<void, DbError> => {
    switch (message._tag) {
      case "Resume":
        return resume;
      case "SendMessage":
        return Effect.asVoid(Effect.flatMap(Effect.exit(sendMessage(message.text)), (exit) => Deferred.done(message.reply, exit)));
      case "Interrupt":
        return Effect.asVoid(Effect.flatMap(Effect.exit(interrupt), (exit) => Deferred.done(message.reply, exit)));
      case "AnswerRequest":
        return Effect.asVoid(
          Effect.flatMap(Effect.exit(answerRequest(message.requestId, message.answer)), (exit) => Deferred.done(message.reply, exit)),
        );
      case "SetModel":
        return Effect.asVoid(Effect.flatMap(Effect.exit(setModel(message.model)), (exit) => Deferred.done(message.reply, exit)));
      case "ProviderEvent":
        return turn?.id === message.turnId ? onProviderEvent(message.event) : Effect.void;
      case "ProviderEnded":
        return turn?.id === message.turnId ? onProviderEnded(message.exit) : Effect.void;
    }
  };

  yield* Queue.offer(mailbox, { _tag: "Resume" });
  yield* Queue.take(mailbox).pipe(
    Effect.flatMap(handle),
    Effect.catchCause((cause) => Effect.logError(`thread ${threadId}: message failed`, cause)),
    Effect.forever,
    Effect.forkIn(actorScope),
  );

  const ask = <A, E>(make: (reply: Deferred.Deferred<A, E>) => Message) =>
    Effect.gen(function* () {
      const reply = yield* Deferred.make<A, E>();
      yield* Queue.offer(mailbox, make(reply));
      return yield* Deferred.await(reply);
    });

  const actor: ThreadActor = {
    sendMessage: (text) => ask((reply) => ({ _tag: "SendMessage", text, reply })),
    interrupt: ask((reply) => ({ _tag: "Interrupt", reply })),
    answerRequest: (requestId, answer) => ask((reply) => ({ _tag: "AnswerRequest", requestId, answer, reply })),
    setModel: (model) => ask((reply) => ({ _tag: "SetModel", model, reply })),
  };
  return actor;
});
