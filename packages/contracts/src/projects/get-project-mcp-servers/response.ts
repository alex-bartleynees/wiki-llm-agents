import { Schema } from "effect";

/**
 * The MCP servers (ids, as in `mcp/<id>.yaml`) whose tools every thread in the project
 * gets, whatever its agent, besides those given to every thread and those its agent lists.
 */
export const GetProjectMcpServersResponse = Schema.Struct({
  serverIds: Schema.Array(Schema.String),
});
export type GetProjectMcpServersResponse = typeof GetProjectMcpServersResponse.Type;
