import { Schema } from "effect";

/**
 * POST /api/mcp-servers/:serverId/restart: closes every connection to the server and
 * forgets its failures, so the next use connects at once. A server with one shared
 * connection (`scope: app`) is connected again straight away.
 */
export const RestartMcpServerRequest = Schema.Struct({
  serverId: Schema.String,
});
export type RestartMcpServerRequest = typeof RestartMcpServerRequest.Type;
