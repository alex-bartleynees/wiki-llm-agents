import { Schema } from "effect";

/** DELETE /api/schedules/:scheduleId: the schedule and its run history go; a scheduled prompt's thread and the inbox items it made stay. */
export const DeleteScheduleRequest = Schema.Struct({ scheduleId: Schema.String });
export type DeleteScheduleRequest = typeof DeleteScheduleRequest.Type;
