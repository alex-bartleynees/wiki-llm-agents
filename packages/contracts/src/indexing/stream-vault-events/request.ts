import { Schema } from "effect";

/**
 * GET /events/vaults/:vaultId: a server-sent event stream of `VaultEvent`s. There is
 * no replay: after a reconnect the client reloads what it shows.
 */
export const StreamVaultEventsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type StreamVaultEventsRequest = typeof StreamVaultEventsRequest.Type;
