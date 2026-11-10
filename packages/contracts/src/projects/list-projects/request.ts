import { Schema } from "effect";

/** GET /api/projects takes no input today; named so the operation reads Request → Endpoint → Response. */
export const ListProjectsRequest = Schema.Struct({});
export type ListProjectsRequest = typeof ListProjectsRequest.Type;
