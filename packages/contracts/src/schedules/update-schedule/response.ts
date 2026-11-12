import { Schema } from "effect";
import { Schedule } from "../model.js";

export const UpdateScheduleResponse = Schema.Struct({ schedule: Schedule });
export type UpdateScheduleResponse = typeof UpdateScheduleResponse.Type;
