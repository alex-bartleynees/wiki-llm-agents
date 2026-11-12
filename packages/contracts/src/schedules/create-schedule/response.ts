import { Schema } from "effect";
import { Schedule } from "../model.js";

export const CreateScheduleResponse = Schema.Struct({ schedule: Schedule });
export type CreateScheduleResponse = typeof CreateScheduleResponse.Type;
