import { Schema } from "effect";

/** POST /api/projects/:projectId/restore: an archived project becomes active again. */
export const RestoreProjectRequest = Schema.Struct({ projectId: Schema.String });
export type RestoreProjectRequest = typeof RestoreProjectRequest.Type;
