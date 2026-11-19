import { Schema } from "effect";
import { SecretSignInUse } from "../model.js";

export const DeleteSecretResponse = Schema.Struct({
  /** MCP servers that still refer to the name and now have no secret. */
  stillUsedBy: Schema.Array(Schema.String),
  /** Browser sign-ins that still refer to it and now have no secret. */
  stillUsedBySignIns: Schema.Array(SecretSignInUse),
});
export type DeleteSecretResponse = typeof DeleteSecretResponse.Type;
