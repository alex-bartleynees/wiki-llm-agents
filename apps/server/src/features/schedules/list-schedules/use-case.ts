import type { ListSchedulesResponse } from "@wiki-agents/contracts/schedules/list-schedules/response";
import type { Schedule } from "@wiki-agents/contracts/schedules/model";
import { Effect } from "effect";
import { AppConfig } from "../../../shared/config.js";
import { LIST_RUNS, present } from "../present.js";
import { ScheduleRepository } from "../repository.js";

const STATUS_ORDER = { active: 0, paused: 1, finished: 2 } as const;

const order = (a: Schedule, b: Schedule) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || b.createdAt - a.createdAt;

/** Active first, then paused, then finished; each by next time, then newest. */
export const listSchedules = Effect.fn("listSchedules")(function* () {
  const repository = yield* ScheduleRepository;
  const schedules = yield* repository.list;
  const runs = yield* repository.runs(
    schedules.map((schedule) => schedule.id),
    LIST_RUNS,
  );
  const response: ListSchedulesResponse = {
    schedules: schedules.map((schedule) => present(schedule, runs)).sort(order),
    defaultTimezone: yield* AppConfig.timezone,
  };
  return response;
});
