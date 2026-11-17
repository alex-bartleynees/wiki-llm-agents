import { Schema } from "effect";

/** GET /api/mcp-servers/:serverId */
export const GetMcpServerRequest = Schema.Struct({
  serverId: Schema.String,
});
export type GetMcpServerRequest = typeof GetMcpServerRequest.Type;
