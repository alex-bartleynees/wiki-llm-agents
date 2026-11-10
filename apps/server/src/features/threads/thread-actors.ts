import type { ContextNote } from "@wiki-agents/contracts/threads/context";
import type { RequestAnswer, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Context, Effect, Layer, RcMap } from "effect";
import { makeThreadActor, type OpenedNote, type ThreadActor } from "./thread-actor.js";

/** How long a ThreadActor with nothing running stays in memory after its last use. */
export const ACTOR_IDLE_TIME = "5 minutes";

/** Errors from starting an actor: the thread, its vault, or its provider is missing. */
type StartError = Effect.Error<ReturnType<typeof makeThreadActor>>;

/** ThreadActors by thread id, started on first use and stopped when idle. */
export interface ThreadActorsService {
  readonly sendMessage: (threadId: string, text: string, notes?: ReadonlyArray<ContextNote>) => Effect.Effect<string, StartError | Effect.Error<ReturnType<ThreadActor["sendMessage"]>>>;
  readonly interrupt: (threadId: string) => Effect.Effect<string, StartError | Effect.Error<ThreadActor["interrupt"]>>;
  readonly answerRequest: (
    threadId: string,
    requestId: string,
    answer: RequestAnswer,
  ) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["answerRequest"]>>>;
  readonly setModel: (threadId: string, model: string) => Effect.Effect<ThreadSummary, StartError | Effect.Error<ReturnType<ThreadActor["setModel"]>>>;
  readonly setAgent: (threadId: string, agentId: string | null) => Effect.Effect<ThreadSummary, StartError | Effect.Error<ReturnType<ThreadActor["setAgent"]>>>;
  readonly recordContext: (threadId: string, note: ContextNote) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["recordContext"]>>>;
  readonly openNote: (threadId: string, note: OpenedNote) => Effect.Effect<void, StartError | Effect.Error<ReturnType<ThreadActor["openNote"]>>>;
  /** Starts the actor, which resumes or closes a turn left running by the last run. */
  readonly wake: (threadId: string) => Effect.Effect<void, StartError>;
}

export class ThreadActors extends Context.Service<ThreadActors, ThreadActorsService>()("ThreadActors") {}

export const ThreadActorsLive = Layer.effect(
  ThreadActors,
  Effect.gen(function* () {
    const actors: RcMap.RcMap<string, ThreadActor, StartError> = yield* RcMap.make({
      lookup: (threadId: string) => makeThreadActor(threadId, Effect.asVoid(RcMap.get(actors, threadId).pipe(Effect.orDie))),
      idleTimeToLive: ACTOR_IDLE_TIME,
    });
    const withActor = <A, E>(threadId: string, use: (actor: ThreadActor) => Effect.Effect<A, E>) =>
      Effect.scoped(Effect.flatMap(RcMap.get(actors, threadId), use));
    return ThreadActors.of({
      sendMessage: (threadId, text, notes) => withActor(threadId, (actor) => actor.sendMessage(text, notes)),
      interrupt: (threadId) => withActor(threadId, (actor) => actor.interrupt),
      answerRequest: (threadId, requestId, answer) => withActor(threadId, (actor) => actor.answerRequest(requestId, answer)),
      setModel: (threadId, model) => withActor(threadId, (actor) => actor.setModel(model)),
      setAgent: (threadId, agentId) => withActor(threadId, (actor) => actor.setAgent(agentId)),
      recordContext: (threadId, note) => withActor(threadId, (actor) => actor.recordContext(note)),
      openNote: (threadId, note) => withActor(threadId, (actor) => actor.openNote(note)),
      wake: (threadId) => withActor(threadId, (actor) => actor.resumed),
    });
  }),
);
