import { Schema } from "effect";

/** POST /api/vaults: register a folder of markdown notes as a vault. */
export const RegisterVaultRequest = Schema.Struct({
  /** Absolute path to the vault folder; `~` is expanded. Symlinks are resolved. */
  rootPath: Schema.String.check(Schema.isNonEmpty()),
  /** Display name; defaults to the folder name. */
  name: Schema.optionalKey(Schema.String),
});
export type RegisterVaultRequest = typeof RegisterVaultRequest.Type;
