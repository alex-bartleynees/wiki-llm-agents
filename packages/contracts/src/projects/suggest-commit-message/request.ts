import { Schema } from "effect";

/**
 * POST /api/projects/:projectId/git/suggest-message with this body. Asks a model for a
 * commit message for these files' changes; never commits.
 */
export const SuggestCommitMessageRequest = Schema.Struct({
  /** One of the project's working directories in git, or a thread's worktree directory. */
  directory: Schema.String,
  /** The ticked files, relative to `directory`, as `get-diff` gave them (a rename by its new path). */
  paths: Schema.Array(Schema.String),
});
export type SuggestCommitMessageRequest = typeof SuggestCommitMessageRequest.Type;
