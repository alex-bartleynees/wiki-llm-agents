import { Schema } from "effect";
import { McpServerSummary } from "../model.js";

/** The server as it is now on disk. */
export const SaveMcpServerResponse = Schema.Struct({
  server: McpServerSummary,
  /** SHA-256 (hex) of what is now on disk: the next save's `baseHash`. */
  hash: Schema.String,
});
export type SaveMcpServerResponse = typeof SaveMcpServerResponse.Type;
