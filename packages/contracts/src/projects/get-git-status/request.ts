import { Schema } from "effect";

/** GET /api/projects/:projectId/git */
export const GetGitStatusRequest = Schema.Struct({ projectId: Schema.String });
export type GetGitStatusRequest = typeof GetGitStatusRequest.Type;
