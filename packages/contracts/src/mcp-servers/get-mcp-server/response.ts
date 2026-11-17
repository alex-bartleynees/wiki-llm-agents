import { Schema } from "effect";
import { McpServerSummary } from "../model.js";

export const GetMcpServerResponse = Schema.Struct({
  server: McpServerSummary,
  /** SHA-256 (hex) of the file's bytes: the `baseHash` for saving or deleting it. */
  hash: Schema.String,
});
export type GetMcpServerResponse = typeof GetMcpServerResponse.Type;
