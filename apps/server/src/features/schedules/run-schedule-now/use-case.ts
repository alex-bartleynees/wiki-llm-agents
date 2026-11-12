import { Effect, Option } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { ScheduleBusy } from "../errors.js";
import { findSchedule, showSchedule } from "../find-schedule.js";
import { LIST_RUNS } from "../present.js";
import { ScheduleRepository } from "../repository.js";
import { runNow } from "../runner.js";

/**
 * A new occurrence now, by hand: a reminder arrives, a scheduled prompt runs (one run
 * at a time). Its regular times stay as they are.
 */
export const runScheduleNow = Effect.fn("runScheduleNow")(function* (scheduleId: string) {
  const schedule = yield* findSchedule(scheduleId);
  const repository = yield* ScheduleRepository;
  if (schedule.kind === "prompt" && Option.isSome(yield* repository.runningRun(scheduleId))) return yield* new ScheduleBusy({ scheduleId });
  const run = yield* runNow(schedule, yield* (yield* WallClock).now);
  // The same millisecond as another Run now.
  if (Option.isNone(run)) return yield* new ScheduleBusy({ scheduleId });
  const latest = yield* repository.runs([scheduleId], LIST_RUNS);
  return { schedule: yield* showSchedule(scheduleId, LIST_RUNS), run: latest.find((candidate) => candidate.id === run.value.id) ?? run.value };
});
