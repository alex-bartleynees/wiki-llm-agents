import { Schema } from "effect";
import { CreateScheduleRequest } from "../create-schedule/request.js";

export const UpdateScheduleParams = Schema.Struct({ scheduleId: Schema.String });
export type UpdateScheduleParams = typeof UpdateScheduleParams.Type;

const { kind: _kind, text, recurrence, ...optional } = CreateScheduleRequest.fields;

/**
 * PATCH /api/schedules/:scheduleId: the fields to change; the rest stay. The kind
 * can't change. A new time takes effect from now: the next run is recomputed.
 */
export const UpdateScheduleRequest = Schema.Struct({
  ...optional,
  text: Schema.optionalKey(text),
  recurrence: Schema.optionalKey(recurrence),
});
export type UpdateScheduleRequest = typeof UpdateScheduleRequest.Type;
