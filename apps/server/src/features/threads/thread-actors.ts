import type { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import type { ContextNote } from "@wiki-agents/contracts/threads/context";
import type { RequestAnswer, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Context, Effect, Layer, RcMap, Semaphore } from "effect";
import type { ToolCallCheck } from "../mcp/gateway.js";
import type { AgentNoteWrite } from "../notes/agent-write/use-case.js";
import type { ThreadBusy } from "./errors.js";
import { type CompactStarted, type HandoffStarted, makeThreadActor, type OpenedNote, type ScheduleReceipt, type SendOptions, type SignInCard, type ThreadActor } from "./thread-actor.js";

/** How long a ThreadActor with nothing running stays in memory after its last use. */
export const ACTOR_IDLE_TIME = "5 minutes";

/** Errors from starting an actor: the thread, its vault, or its provider is missing. */
type StartError = Effect.Error<ReturnType<typeof makeThreadActor>>;

/** ThreadActors by thread id, started on first use and stopped when idle. */
export interface ThreadActorsService {
  readonly sendMessage: (threadId: string, text: string, notes?: ReadonlyArray<ContextNote>, options?: SendOptions) => Effect.Effect<string, StartError | Effect.Error<ReturnType<ThreadActor["sendMessage"]>>>;
  readonly interrupt: (threadId: string) => Effect.Effect<string | null, StartError | Effect.Error<ThreadActor["interrupt"]>>;
  /** See `ThreadActor.compact`. */
  readonly compact: (threadId: string, operationId: string) => Effect.Effect<CompactStarted, StartError | Effect.Error<ReturnType<ThreadActor["compact"]>>>;
  /** See `ThreadActor.handoff`. */
  readonly handoff: (threadId: string, operationId: string) => Effect.Effect<HandoffStarted, StartError | Effect.Error<ReturnType<ThreadActor["handoff"]>>>;
  readonly answerRequest: (
    threadId: string,
    requestId: string,
    answer: RequestAnswer,
  ) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["answerRequest"]>>>;
  readonly setModel: (threadId: string, model: string) => Effect.Effect<ThreadSummary, StartError | Effect.Error<ReturnType<ThreadActor["setModel"]>>>;
  readonly setAgent: (threadId: string, agentId: string | null) => Effect.Effect<ThreadSummary, StartError | Effect.Error<ReturnType<ThreadActor["setAgent"]>>>;
  readonly setDone: (threadId: string, done: boolean) => Effect.Effect<ThreadSummary, StartError | Effect.Error<ReturnType<ThreadActor["setDone"]>>>;
  readonly writeNote: (threadId: string, input: AgentNoteWrite) => Effect.Effect<SaveNoteResponse, StartError | Effect.Error<ReturnType<ThreadActor["writeNote"]>>>;
  /** See `ThreadActor.approveToolCall`. */
  readonly approveToolCall: (threadId: string, call: ToolCallCheck) => Effect.Effect<Effect.Effect<void>, StartError | Effect.Error<ReturnType<ThreadActor["approveToolCall"]>>>;
  readonly recordContext:(threadId: string, note: ContextNote) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["recordContext"]>>>;
  readonly openNote: (threadId: string, note: OpenedNote) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["openNote"]>>>;
  readonly scheduleSaved: (threadId: string, receipt: ScheduleReceipt) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["scheduleSaved"]>>>;
  /** Shows the "needs a sign-in" card in the thread's running turn. */
  readonly signInNeeded: (threadId: string, card: SignInCard) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["signInNeeded"]>>>;
  readonly changeUndone: (threadId: string, turnId: string, changeId: string) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["changeUndone"]>>>;
  /** Runs `effect` while the thread has no turn running or waiting (see `ThreadActor.whileIdle`). */
  readonly whileIdle: <A, E>(threadId: string, effect: Effect.Effect<A, E>) => Effect.Effect<A, StartError | E | ThreadBusy>;
  /** Serializes a child launch or follow-up with Stop. */
  readonly withChildMutation: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly childReports: (threadId: string) => Effect.Effect<void, StartError>;
  /** Starts the actor, which resumes or closes a turn left running by the last run. */
  readonly wake: (threadId: string) => Effect.Effect<void, StartError>;
}

export class ThreadActors extends Context.Service<ThreadActors, ThreadActorsService>()("ThreadActors") {}

export const ThreadActorsLive = Layer.effect(
  ThreadActors,
  Effect.gen(function* () {
    const mutations = yield* Semaphore.make(1);
    const actors: RcMap.RcMap<string, ThreadActor, StartError> = yield* RcMap.make({
      lookup: (threadId: string) => makeThreadActor(
        threadId,
        Effect.asVoid(RcMap.get(actors, threadId).pipe(Effect.orDie)),
        (managerId) => Effect.scoped(Effect.flatMap(RcMap.get(actors, managerId), (actor) => actor.childReports)).pipe(
          Effect.catch((error) => Effect.logWarning(`can't deliver child report to thread ${managerId}`, error)),
        ),
        (childId) => Effect.scoped(Effect.flatMap(RcMap.get(actors, childId), (actor) => actor.interrupt)).pipe(
          Effect.asVoid,
          Effect.catch((error) => error._tag === "NoTurnRunning"
            ? Effect.void
            : Effect.logWarning(`can't stop child thread ${childId}`, error)),
        ),
      ),
      idleTimeToLive: ACTOR_IDLE_TIME,
    });
    const withActor = <A, E>(threadId: string, use: (actor: ThreadActor) => Effect.Effect<A, E>) =>
      Effect.scoped(Effect.flatMap(RcMap.get(actors, threadId), use));
    return ThreadActors.of({
      sendMessage: (threadId, text, notes, options) => withActor(threadId, (actor) => actor.sendMessage(text, notes, options)),
      interrupt: (threadId) => mutations.withPermits(1)(withActor(threadId, (actor) => actor.interrupt)),
      withChildMutation: mutations.withPermits(1),
      compact: (threadId, operationId) => withActor(threadId, (actor) => actor.compact(operationId)),
      handoff: (threadId, operationId) => withActor(threadId, (actor) => actor.handoff(operationId)),
      answerRequest: (threadId, requestId, answer) => withActor(threadId, (actor) => actor.answerRequest(requestId, answer)),
      setModel: (threadId, model) => withActor(threadId, (actor) => actor.setModel(model)),
      setAgent: (threadId, agentId) => withActor(threadId, (actor) => actor.setAgent(agentId)),
      setDone: (threadId, done) => withActor(threadId, (actor) => actor.setDone(done)),
      writeNote: (threadId, input) => withActor(threadId, (actor) => actor.writeNote(input)),
      approveToolCall: (threadId, call) => withActor(threadId, (actor) => actor.approveToolCall(call)),
      recordContext: (threadId, note) => withActor(threadId, (actor) => actor.recordContext(note)),
      openNote: (threadId, note) => withActor(threadId, (actor) => actor.openNote(note)),
      scheduleSaved: (threadId, receipt) => withActor(threadId, (actor) => actor.scheduleSaved(receipt)),
      signInNeeded: (threadId, card) => withActor(threadId, (actor) => actor.signInNeeded(card)),
      changeUndone: (threadId, turnId, changeId) => withActor(threadId, (actor) => actor.changeUndone(turnId, changeId)),
      whileIdle: (threadId, effect) => withActor(threadId, (actor) => actor.whileIdle(effect)),
      childReports: (threadId) => withActor(threadId, (actor) => actor.childReports),
      wake: (threadId) => withActor(threadId, (actor) => actor.resumed),
    });
  }),
);
