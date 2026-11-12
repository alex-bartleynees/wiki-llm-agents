import { Schema } from "effect";
import { Schedule } from "../model.js";

export const ListSchedulesResponse = Schema.Struct({
  /** Active first, then paused, then finished; each by next run, then newest. */
  schedules: Schema.Array(Schedule),
  /** The timezone new schedules use unless they say otherwise. */
  defaultTimezone: Schema.String,
});
export type ListSchedulesResponse = typeof ListSchedulesResponse.Type;
