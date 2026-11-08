import { Schema } from "effect";

/** A registered vault: a folder of markdown notes the app indexes and agents can use. */
export const Vault = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rootPath: Schema.String,
});
export type Vault = typeof Vault.Type;
