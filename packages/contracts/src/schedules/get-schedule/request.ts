import { Schema } from "effect";

/** GET /api/schedules/:scheduleId: the schedule and more of its runs. */
export const GetScheduleRequest = Schema.Struct({ scheduleId: Schema.String });
export type GetScheduleRequest = typeof GetScheduleRequest.Type;
