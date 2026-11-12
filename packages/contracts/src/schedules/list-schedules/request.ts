import { Schema } from "effect";

/** GET /api/schedules takes no input; every schedule, with its latest runs. */
export const ListSchedulesRequest = Schema.Struct({});
export type ListSchedulesRequest = typeof ListSchedulesRequest.Type;
