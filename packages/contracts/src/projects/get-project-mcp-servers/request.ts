import { Schema } from "effect";

/** GET /api/projects/:projectId/mcp-servers */
export const GetProjectMcpServersRequest = Schema.Struct({});
export type GetProjectMcpServersRequest = typeof GetProjectMcpServersRequest.Type;
