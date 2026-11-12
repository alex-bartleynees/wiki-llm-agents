import { Schema } from "effect";

/** POST /api/schedules/:scheduleId/resume: fires again from the next time after now; times missed while paused don't run. */
export const ResumeScheduleRequest = Schema.Struct({ scheduleId: Schema.String });
export type ResumeScheduleRequest = typeof ResumeScheduleRequest.Type;
