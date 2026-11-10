import { Schema } from "effect";

/** POST /api/vaults/:vaultId/threads with this body. The agent works in the vault's folder. */
export const CreateThreadRequest = Schema.Struct({
  /** Defaults to the agent's provider, else the first provider instance. */
  providerInstanceId: Schema.optionalKey(Schema.String),
  /** A named agent (`GET /api/agents`); without one, the thread follows the rules alone. */
  agentId: Schema.optionalKey(Schema.String),
});
export type CreateThreadRequest = typeof CreateThreadRequest.Type;
