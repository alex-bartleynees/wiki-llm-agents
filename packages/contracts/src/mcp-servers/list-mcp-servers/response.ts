import { Schema } from "effect";
import { ConfigProblem } from "../../agents/model.js";
import { McpServerStatus, McpServerSummary } from "../model.js";

export const ListMcpServersResponse = Schema.Struct({
  /** The folder the server files live in: `<config dir>/mcp`. */
  folder: Schema.String,
  /** Valid servers, by title. */
  servers: Schema.Array(McpServerSummary),
  /** Files that couldn't be loaded; a server with a problem isn't listed in `servers`. */
  problems: Schema.Array(ConfigProblem),
  /** How the app's connections to each valid server are doing, in the order of `servers`. */
  statuses: Schema.Array(McpServerStatus),
});
export type ListMcpServersResponse = typeof ListMcpServersResponse.Type;
