import { Schema } from "effect";
import { Schedule } from "../model.js";

export const ResumeScheduleResponse = Schema.Struct({ schedule: Schedule });
export type ResumeScheduleResponse = typeof ResumeScheduleResponse.Type;
