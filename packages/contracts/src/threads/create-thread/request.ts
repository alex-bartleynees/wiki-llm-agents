import { Schema } from "effect";

/** POST /api/vaults/:vaultId/threads with this body. The agent works in the vault's folder. */
export const CreateThreadRequest = Schema.Struct({
  /** Defaults to the first provider instance (the replay provider for now). */
  providerInstanceId: Schema.optionalKey(Schema.String),
});
export type CreateThreadRequest = typeof CreateThreadRequest.Type;
