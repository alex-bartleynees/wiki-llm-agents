import { Schema } from "effect";

/** POST /api/schedules/:scheduleId/run: fires it now, by hand (409 while a scheduled prompt's run is still going). Its regular times are unchanged. */
export const RunScheduleNowRequest = Schema.Struct({ scheduleId: Schema.String });
export type RunScheduleNowRequest = typeof RunScheduleNowRequest.Type;
