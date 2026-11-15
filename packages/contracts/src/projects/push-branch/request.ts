import { Schema } from "effect";

/**
 * POST /api/projects/:projectId/git/push with this body. Pushes the current branch to
 * its upstream; never forced, never another branch. A branch without an upstream is
 * pushed only with `setUpstream` (`git push -u <remote> <branch>`).
 */
export const PushBranchRequest = Schema.Struct({
  /** One of the project's working directories in git, or a thread's worktree directory. */
  directory: Schema.String,
  /** The branch you saw checked out; refused (409) when another one is now. */
  branch: Schema.String,
  /** For a branch without an upstream: the remote you agreed to push it to (`GitStatus.pushRemote`). */
  setUpstream: Schema.optionalKey(Schema.Struct({ remote: Schema.String })),
});
export type PushBranchRequest = typeof PushBranchRequest.Type;
