import type { UpdateScheduleRequest } from "@wiki-agents/contracts/schedules/update-schedule/request";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { findSchedule } from "../../../schedules/find-schedule.js";
import { updateSchedule } from "../../../schedules/update-schedule/use-case.js";
import { VaultCaller } from "../../auth.js";
import {
  DateParam,
  Days,
  MissedParam,
  Receipt,
  receiptOf,
  recordReceipt,
  Repeat,
  ScheduleId,
  scheduleFailure,
  scheduleTool,
  Time,
  Timezone,
  toRecurrence,
} from "../schedule-shared.js";
import { ToolFailure } from "../shared.js";

export const ScheduleUpdate = scheduleTool(
  Tool.make("schedule_update", {
    description:
      "Changes a schedule: only what you give changes. A new time applies from now. Ask the user about a genuinely ambiguous time first. Changes to a scheduled prompt apply from its next run.",
    parameters: Schema.Struct({
      scheduleId: ScheduleId,
      text: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
      title: Schema.optionalKey(Schema.String),
      repeat: Schema.optionalKey(Repeat),
      time: Schema.optionalKey(Time),
      date: Schema.optionalKey(DateParam),
      days: Schema.optionalKey(Days),
      timezone: Schema.optionalKey(Timezone),
      agentId: Schema.optionalKey(Schema.NullOr(Schema.String).annotate({ description: "Scheduled prompt only; null for the rules alone." })),
      model: Schema.optionalKey(Schema.String),
      missed: Schema.optionalKey(MissedParam),
    }),
    success: Receipt,
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const scheduleUpdate = Effect.fnUntraced(
  function* (params: typeof ScheduleUpdate.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const current = yield* findSchedule(params.scheduleId);
    const recurrence = yield* toRecurrence(params, current.recurrence);
    const request: UpdateScheduleRequest = {
      ...(params.text === undefined ? {} : { text: params.text }),
      ...(params.title === undefined ? {} : { title: params.title }),
      ...(recurrence === undefined ? {} : { recurrence }),
      ...(params.timezone === undefined ? {} : { timezone: params.timezone }),
      ...(params.agentId === undefined ? {} : { agentId: params.agentId }),
      ...(params.model === undefined ? {} : { model: params.model }),
      ...(params.missed === undefined ? {} : { missed: params.missed }),
    };
    const receipt = yield* receiptOf(yield* updateSchedule(params.scheduleId, request));
    yield* recordReceipt(threadId, receipt, "updated");
    return receipt;
  },
  Effect.catch((error) => Effect.fail(scheduleFailure(error))),
);
