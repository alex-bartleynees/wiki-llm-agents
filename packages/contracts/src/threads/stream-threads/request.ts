import { Schema } from "effect";

/** GET /events/vaults/:vaultId/threads: `ThreadsStreamMessage`s for the vault's thread list. */
export const StreamThreadsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type StreamThreadsRequest = typeof StreamThreadsRequest.Type;
