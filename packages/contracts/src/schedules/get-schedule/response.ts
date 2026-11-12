import { Schema } from "effect";
import { Schedule } from "../model.js";

/** `schedule.runs` holds up to 50 runs here. */
export const GetScheduleResponse = Schema.Struct({ schedule: Schedule });
export type GetScheduleResponse = typeof GetScheduleResponse.Type;
