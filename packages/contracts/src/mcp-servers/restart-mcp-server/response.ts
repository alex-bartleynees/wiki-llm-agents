import { Schema } from "effect";
import { McpServerStatus } from "../model.js";

export const RestartMcpServerResponse = Schema.Struct({
  status: McpServerStatus,
});
export type RestartMcpServerResponse = typeof RestartMcpServerResponse.Type;
