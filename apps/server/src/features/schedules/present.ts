import type { Schedule, ScheduleRun } from "@wiki-agents/contracts/schedules/model";
import { describeInstant, describeRecurrence } from "../../shared/time/recurrence.js";
import type { StoredSchedule } from "./repository.js";

/** Runs shown with each schedule in the list; one schedule shows more. */
export const LIST_RUNS = 5;
export const DETAIL_RUNS = 50;

/** The schedule as the app shows it: its next time as a concrete local date, time and timezone, and its runs. */
export const present = (schedule: StoredSchedule, runs: ReadonlyArray<ScheduleRun>): Schedule => ({
  ...schedule,
  nextLabel: schedule.nextAt === null ? null : describeInstant(schedule.nextAt, schedule.timezone),
  recurrenceLabel: describeRecurrence(schedule.recurrence),
  runs: runs.filter((run) => run.scheduleId === schedule.id),
});
