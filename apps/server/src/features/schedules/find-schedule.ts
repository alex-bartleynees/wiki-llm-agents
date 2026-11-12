import { Effect, Option } from "effect";
import { ScheduleNotFound } from "./errors.js";
import { present } from "./present.js";
import { ScheduleRepository } from "./repository.js";

export const findSchedule = Effect.fnUntraced(function* (scheduleId: string) {
  const schedule = yield* (yield* ScheduleRepository).find(scheduleId);
  if (Option.isNone(schedule)) return yield* new ScheduleNotFound({ scheduleId });
  return schedule.value;
});

/** The schedule with its latest runs, as the app shows it. */
export const showSchedule = Effect.fnUntraced(function* (scheduleId: string, runs: number) {
  const schedule = yield* findSchedule(scheduleId);
  return present(schedule, yield* (yield* ScheduleRepository).runs([scheduleId], runs));
});
