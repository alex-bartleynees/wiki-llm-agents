import { Schema } from "effect";

/**
 * Where the new thread works:
 * - `same`: where the source thread works. For a thread in a worktree, the new
 *   thread shares that worktree: both work in the same files.
 * - `main`: the project's main working directory, without the worktree's branch or
 *   uncommitted changes.
 * - `worktree`: a new worktree on a new branch from the main directory's `HEAD`,
 *   which lacks any uncommitted work.
 */
export const ContinueWorkspace = Schema.Union([
  Schema.Literals(["same", "main"]),
  Schema.Struct({ worktree: Schema.Struct({ branch: Schema.String }) }),
]);
export type ContinueWorkspace = typeof ContinueWorkspace.Type;

/**
 * POST /api/threads/:threadId/continue with this body: makes a new thread that
 * continues this one, with a fresh provider session. It keeps the vault, project,
 * provider, agent and model, and gets `text` as its composer draft: nothing is sent
 * until you send it. The source thread is left as it is.
 */
export const ContinueThreadRequest = Schema.Struct({
  /** The handoff, as reviewed; becomes the new thread's draft. */
  text: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100_000)),
  /** Defaults to `same`. Only `same` for a thread outside a project. */
  workspace: Schema.optionalKey(ContinueWorkspace),
});
export type ContinueThreadRequest = typeof ContinueThreadRequest.Type;
