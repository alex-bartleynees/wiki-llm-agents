import { Schema } from "effect";

export const DeleteSecretResponse = Schema.Struct({
  /** MCP servers that still refer to the name and now have no secret. */
  stillUsedBy: Schema.Array(Schema.String),
});
export type DeleteSecretResponse = typeof DeleteSecretResponse.Type;
