import { Effect } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { InvalidSchedule } from "../errors.js";
import { findSchedule, showSchedule } from "../find-schedule.js";
import { LIST_RUNS } from "../present.js";
import { ScheduleRepository } from "../repository.js";
import { SchedulerSignal } from "../signal.js";

/** Stops it firing until resumed; a run already going finishes. */
export const pauseSchedule = Effect.fn("pauseSchedule")(function* (scheduleId: string) {
  const current = yield* findSchedule(scheduleId);
  if (current.status === "finished") return yield* new InvalidSchedule({ message: "It has finished; give it a new time instead." });
  const now = yield* (yield* WallClock).now;
  yield* (yield* ScheduleRepository).save({ ...current, status: "paused", pausedReason: null, nextAt: null, updatedAt: now });
  yield* (yield* SchedulerSignal).wake;
  return yield* showSchedule(scheduleId, LIST_RUNS);
});
