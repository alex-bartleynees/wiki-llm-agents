import { Schema } from "effect";
import { SecretSummary } from "../model.js";

export const SetSecretResponse = Schema.Struct({
  secret: SecretSummary,
});
export type SetSecretResponse = typeof SetSecretResponse.Type;
