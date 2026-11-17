import { Schema } from "effect";
import { SecretStoreStatus, SecretSummary } from "../model.js";

/** Names and dates only; no value is ever returned. */
export const ListSecretsResponse = Schema.Struct({
  /** By name. */
  secrets: Schema.Array(SecretSummary),
  store: SecretStoreStatus,
  /** Entries of `WIKI_AGENTS_SECRET_FILES` that couldn't be used. */
  problems: Schema.Array(Schema.String),
});
export type ListSecretsResponse = typeof ListSecretsResponse.Type;
