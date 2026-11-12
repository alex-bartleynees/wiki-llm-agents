import { Context, Effect, Layer, Queue } from "effect";

/** Tells the scheduler that schedules changed, so it looks again at what is due next. */
export interface SchedulerSignalService {
  readonly wake: Effect.Effect<void>;
  /** Returns at the next `wake`; for the scheduler. */
  readonly woken: Effect.Effect<void>;
}

export class SchedulerSignal extends Context.Service<SchedulerSignal, SchedulerSignalService>()("SchedulerSignal") {}

export const SchedulerSignalLive = Layer.effect(
  SchedulerSignal,
  Effect.gen(function* () {
    // One pending wake is enough: the scheduler reads everything due when it wakes.
    const wakes = yield* Queue.sliding<void>(1);
    return SchedulerSignal.of({ wake: Effect.asVoid(Queue.offer(wakes, undefined)), woken: Queue.take(wakes) });
  }),
);
