import { Effect } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { InvalidSchedule } from "../errors.js";
import { findSchedule, showSchedule } from "../find-schedule.js";
import { nextTime } from "../fields.js";
import { LIST_RUNS } from "../present.js";
import { ScheduleRepository } from "../repository.js";
import { SchedulerSignal } from "../signal.js";

/** Fires again from its next time after now; times missed while paused don't run. */
export const resumeSchedule = Effect.fn("resumeSchedule")(function* (scheduleId: string) {
  const current = yield* findSchedule(scheduleId);
  if (current.status === "finished") return yield* new InvalidSchedule({ message: "It has finished; give it a new time instead." });
  const now = yield* (yield* WallClock).now;
  const nextAt = yield* nextTime(current, now);
  yield* (yield* ScheduleRepository).save({ ...current, status: "active", pausedReason: null, nextAt, updatedAt: now });
  yield* (yield* SchedulerSignal).wake;
  return yield* showSchedule(scheduleId, LIST_RUNS);
});
