import { Schema } from "effect";

/** GET /api/projects/:projectId/diff */
export const GetDiffRequest = Schema.Struct({ projectId: Schema.String });
export type GetDiffRequest = typeof GetDiffRequest.Type;
