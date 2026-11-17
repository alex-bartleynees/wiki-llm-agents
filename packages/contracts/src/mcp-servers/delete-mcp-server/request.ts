import { Schema } from "effect";

/**
 * DELETE /api/mcp-servers/:serverId?hash=…: moves `mcp/<serverId>.yaml` to the config
 * directory's `.trash/`, only if it is still the version you saw (409 otherwise).
 */
export const DeleteMcpServerRequest = Schema.Struct({
  serverId: Schema.String,
  /** SHA-256 of the file as last seen (`get-mcp-server`). */
  hash: Schema.String,
});
export type DeleteMcpServerRequest = typeof DeleteMcpServerRequest.Type;
