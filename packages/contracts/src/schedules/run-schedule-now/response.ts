import { Schema } from "effect";
import { Schedule, ScheduleRun } from "../model.js";

export const RunScheduleNowResponse = Schema.Struct({ schedule: Schedule, run: ScheduleRun });
export type RunScheduleNowResponse = typeof RunScheduleNowResponse.Type;
