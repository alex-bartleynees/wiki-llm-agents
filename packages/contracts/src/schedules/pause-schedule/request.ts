import { Schema } from "effect";

/** POST /api/schedules/:scheduleId/pause: stops it firing until resumed. */
export const PauseScheduleRequest = Schema.Struct({ scheduleId: Schema.String });
export type PauseScheduleRequest = typeof PauseScheduleRequest.Type;
