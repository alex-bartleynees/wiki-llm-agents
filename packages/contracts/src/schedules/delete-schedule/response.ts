import { Schema } from "effect";

export const DeleteScheduleResponse = Schema.Struct({ scheduleId: Schema.String });
export type DeleteScheduleResponse = typeof DeleteScheduleResponse.Type;
