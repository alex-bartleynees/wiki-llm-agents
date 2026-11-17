import { Schema } from "effect";

/**
 * DELETE /api/secrets/:name: forgets a stored secret. 409 while MCP servers refer to
 * it, unless `force=true`; 409 for a declared one, which is removed where it is declared.
 */
export const DeleteSecretRequest = Schema.Struct({
  name: Schema.String,
  force: Schema.optionalKey(Schema.Literals(["true", "false"])),
});
export type DeleteSecretRequest = typeof DeleteSecretRequest.Type;
