import { Schema } from "effect";

/**
 * DELETE /api/mcp-servers/:serverId/connection: forgets the server's tokens. A client
 * the app registered there is kept, so connecting again reuses it.
 */
export const DisconnectRequest = Schema.Struct({
  serverId: Schema.String,
});
export type DisconnectRequest = typeof DisconnectRequest.Type;
