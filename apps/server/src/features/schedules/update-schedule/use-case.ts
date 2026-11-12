import type { UpdateScheduleRequest } from "@wiki-agents/contracts/schedules/update-schedule/request";
import type { ScheduleFields } from "@wiki-agents/contracts/schedules/model";
import { Effect } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { findSchedule, showSchedule } from "../find-schedule.js";
import { nextTime, promptThread, validateFields } from "../fields.js";
import { LIST_RUNS } from "../present.js";
import { ScheduleRepository } from "../repository.js";
import { SchedulerSignal } from "../signal.js";

/**
 * Changes what was given. A new time or timezone takes effect from now (a finished
 * one-off given a new time is active again); a paused schedule stays paused.
 * Prompt changes apply from the next run.
 */
export const updateSchedule = Effect.fn("updateSchedule")(function* (scheduleId: string, request: UpdateScheduleRequest) {
  const current = yield* findSchedule(scheduleId);
  const defined = Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as Partial<ScheduleFields>;
  const fields: ScheduleFields = {
    kind: current.kind,
    text: current.text,
    recurrence: current.recurrence,
    timezone: current.timezone,
    vaultId: current.vaultId,
    projectId: current.projectId,
    agentId: current.agentId,
    providerInstanceId: current.providerInstanceId,
    model: current.model,
    link: current.link,
    missed: current.missed,
    ...defined,
    // A blank title keeps the current one.
    title: request.title?.trim() || current.title,
  };
  yield* validateFields(fields);
  const now = yield* (yield* WallClock).now;
  const retimed = request.recurrence !== undefined || request.timezone !== undefined;
  let { status, nextAt } = current;
  if (status !== "paused" && retimed) {
    nextAt = yield* nextTime(fields, now);
    status = "active";
  }
  const threadId = yield* promptThread(fields, current);
  yield* (yield* ScheduleRepository).save({ ...current, ...fields, threadId, status, nextAt, updatedAt: now });
  yield* (yield* SchedulerSignal).wake;
  return yield* showSchedule(scheduleId, LIST_RUNS);
});
