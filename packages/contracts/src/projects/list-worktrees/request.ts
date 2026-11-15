import { Schema } from "effect";

/** GET /api/projects/:projectId/worktrees */
export const ListWorktreesRequest = Schema.Struct({ projectId: Schema.String });
export type ListWorktreesRequest = typeof ListWorktreesRequest.Type;
