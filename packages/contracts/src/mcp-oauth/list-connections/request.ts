import { Schema } from "effect";

/** GET /api/mcp-servers/oauth/connections */
export const ListConnectionsRequest = Schema.Struct({});
export type ListConnectionsRequest = typeof ListConnectionsRequest.Type;
