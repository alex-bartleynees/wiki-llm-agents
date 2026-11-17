import { Schema } from "effect";
import { McpConnection } from "../model.js";

export const ListConnectionsResponse = Schema.Struct({
  /** One per server that can sign in: reached by URL, without its own `Authorization` header. */
  connections: Schema.Array(McpConnection),
});
export type ListConnectionsResponse = typeof ListConnectionsResponse.Type;
