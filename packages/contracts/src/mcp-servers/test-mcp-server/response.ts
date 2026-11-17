import { Schema } from "effect";
import { McpServerStatus } from "../model.js";

export const TestMcpServerResponse = Schema.Struct({
  status: McpServerStatus,
});
export type TestMcpServerResponse = typeof TestMcpServerResponse.Type;
