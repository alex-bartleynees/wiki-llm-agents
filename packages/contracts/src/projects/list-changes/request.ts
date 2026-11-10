import { Schema } from "effect";

/** GET /api/projects/:projectId/changes */
export const ListChangesRequest = Schema.Struct({ projectId: Schema.String });
export type ListChangesRequest = typeof ListChangesRequest.Type;
