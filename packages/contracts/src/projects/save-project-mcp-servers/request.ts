import { Schema } from "effect";

/**
 * PUT /api/projects/:projectId/mcp-servers with this body: the whole list, which
 * replaces the project's. 400 with the problems (`projectMcpServerProblems`) when it
 * can't be saved. Threads get the new list from their next turn.
 */
export const SaveProjectMcpServersRequest = Schema.Struct({
  serverIds: Schema.Array(Schema.String),
});
export type SaveProjectMcpServersRequest = typeof SaveProjectMcpServersRequest.Type;
