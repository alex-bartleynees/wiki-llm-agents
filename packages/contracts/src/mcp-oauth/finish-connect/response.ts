import { Schema } from "effect";
import { McpConnection } from "../model.js";

export const FinishConnectResponse = Schema.Struct({
  connection: McpConnection,
});
export type FinishConnectResponse = typeof FinishConnectResponse.Type;
