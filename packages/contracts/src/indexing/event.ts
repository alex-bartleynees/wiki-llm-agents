import { Schema } from "effect";

/** Sent first on every vault event stream, once the server is subscribed. */
export const StreamReady = Schema.Struct({
  type: Schema.Literal("ready"),
});

/**
 * Files in the vault changed on disk and the index has caught up. `paths` are
 * vault-relative and include added, modified, and removed files. Links between notes
 * may have been re-resolved too, so backlinks anywhere in the vault can change.
 */
export const VaultChanged = Schema.Struct({
  type: Schema.Literal("vault.changed"),
  vaultId: Schema.String,
  paths: Schema.Array(Schema.String),
});
export type VaultChanged = typeof VaultChanged.Type;

/** Events on GET /events/vaults/:vaultId, one JSON object per SSE `data:` line. */
export const VaultEvent = Schema.Union([StreamReady, VaultChanged]);
export type VaultEvent = typeof VaultEvent.Type;
