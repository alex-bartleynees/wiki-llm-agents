import { Schema } from "effect";

/** POST /api/vaults/:vaultId/pins with this body. Pinning a pinned file changes nothing. */
export const PinNoteRequest = Schema.Struct({
  /** Vault-relative path of a file in the vault. */
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type PinNoteRequest = typeof PinNoteRequest.Type;
