import { Schema } from "effect";
import { Schedule } from "../model.js";

export const PauseScheduleResponse = Schema.Struct({ schedule: Schedule });
export type PauseScheduleResponse = typeof PauseScheduleResponse.Type;
