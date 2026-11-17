import { Schema } from "effect";
import { McpConnection } from "../model.js";

export const DisconnectResponse = Schema.Struct({
  connection: McpConnection,
});
export type DisconnectResponse = typeof DisconnectResponse.Type;
