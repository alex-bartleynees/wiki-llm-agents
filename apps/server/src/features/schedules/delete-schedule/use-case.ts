import { Effect } from "effect";
import { ScheduleNotFound } from "../errors.js";
import { ScheduleRepository } from "../repository.js";
import { SchedulerSignal } from "../signal.js";

/** The schedule and its run history go; its thread and inbox items stay. */
export const deleteSchedule = Effect.fn("deleteSchedule")(function* (scheduleId: string) {
  if (!(yield* (yield* ScheduleRepository).remove(scheduleId))) return yield* new ScheduleNotFound({ scheduleId });
  yield* (yield* SchedulerSignal).wake;
  return scheduleId;
});
