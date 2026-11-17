import { Schema } from "effect";

export const DeleteMcpServerResponse = Schema.Struct({
  /** Where the file went: `<config dir>/.trash/mcp/<id>.yaml`, or `<id> 1.yaml` when that was taken. */
  trashPath: Schema.String,
});
export type DeleteMcpServerResponse = typeof DeleteMcpServerResponse.Type;
