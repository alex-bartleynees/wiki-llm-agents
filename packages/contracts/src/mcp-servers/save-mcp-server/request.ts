import { Schema } from "effect";
import { McpServerInput } from "../model.js";

/**
 * PUT /api/mcp-servers/:serverId with this body: writes `mcp/<serverId>.yaml` only if
 * the file is still the version the edit started from, else 409 and nothing is
 * written. Settings the app would refuse to load are refused with 422, one problem
 * per line, each starting with its field (`transport.url: …`).
 */
export const SaveMcpServerRequest = Schema.Struct({
  server: McpServerInput,
  /** The `hash` the edit started from; null creates a server that mustn't exist yet. */
  baseHash: Schema.NullOr(Schema.String),
});
export type SaveMcpServerRequest = typeof SaveMcpServerRequest.Type;
