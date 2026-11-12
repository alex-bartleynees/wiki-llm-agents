import { Schema } from "effect";

/** A registered vault: a folder of markdown notes the app indexes and agents can use. */
export const Vault = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rootPath: Schema.String,
  /** Vault-relative folder whose notes are templates for new notes; null when not set. */
  templateFolder: Schema.NullOr(Schema.String),
});
export type Vault = typeof Vault.Type;
