import { randomUUID } from "node:crypto";
import type { CreateScheduleRequest } from "@wiki-agents/contracts/schedules/create-schedule/request";
import type { ScheduleFields } from "@wiki-agents/contracts/schedules/model";
import { Effect } from "effect";
import { AppConfig } from "../../../shared/config.js";
import { WallClock } from "../../../shared/wall-clock.js";
import { nextTime, promptThread, titleFrom, validateFields } from "../fields.js";
import { present } from "../present.js";
import { ScheduleRepository } from "../repository.js";
import { SchedulerSignal } from "../signal.js";

/** Saves a reminder or scheduled prompt (with its own thread) and tells the scheduler. */
export const createSchedule = Effect.fn("createSchedule")(function* (request: CreateScheduleRequest) {
  const fields: ScheduleFields = {
    kind: request.kind,
    title: request.title?.trim() || titleFrom(request.text),
    text: request.text,
    recurrence: request.recurrence,
    timezone: request.timezone ?? (yield* AppConfig.timezone),
    vaultId: request.vaultId ?? null,
    projectId: request.projectId ?? null,
    agentId: request.agentId ?? null,
    providerInstanceId: request.providerInstanceId ?? null,
    model: request.model ?? null,
    link: request.link ?? null,
    missed: request.missed ?? "same-day",
  };
  yield* validateFields(fields);
  const now = yield* (yield* WallClock).now;
  const nextAt = yield* nextTime(fields, now);
  const threadId = yield* promptThread(fields, null);
  const schedule = yield* (yield* ScheduleRepository).insert({
    ...fields,
    id: randomUUID(),
    threadId,
    status: "active",
    pausedReason: null,
    nextAt,
    createdAt: now,
    updatedAt: now,
  });
  yield* (yield* SchedulerSignal).wake;
  return present(schedule, []);
});
