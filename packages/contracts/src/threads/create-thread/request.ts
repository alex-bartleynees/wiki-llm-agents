import { Schema } from "effect";

/**
 * POST /api/vaults/:vaultId/threads with this body. The agent works in the vault's
 * folder, or in the project's main working directory with the vault as shared notes.
 */
export const CreateThreadRequest = Schema.Struct({
  /** Explicit model; omitted keeps the agent/provider default. */
  model: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  /** A project (`GET /api/projects`) whose shared vault is this vault. */
  projectId: Schema.optionalKey(Schema.String),
  /** Defaults to the agent's provider, else the first provider instance. */
  providerInstanceId: Schema.optionalKey(Schema.String),
  /** A named agent (`GET /api/agents`); without one, the thread follows the rules alone. */
  agentId: Schema.optionalKey(Schema.String),
  /**
   * Run the thread in its own git worktree on a new branch, made from the main
   * directory's `HEAD` before the thread exists. Only for a project whose main
   * directory is in git and outside the shared vault; when git refuses (the branch
   * exists, say), no thread is made and the response (409) is git's message.
   */
  worktree: Schema.optionalKey(Schema.Struct({ branch: Schema.String })),
});
export type CreateThreadRequest = typeof CreateThreadRequest.Type;
