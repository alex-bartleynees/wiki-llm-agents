import { Schema } from "effect";

export const Vault = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rootPath: Schema.String,
  templateFolder: Schema.NullOr(Schema.String),
});
export type Vault = typeof Vault.Type;
