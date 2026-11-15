import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/worktree/remove, no body. Runs `git worktree remove`
 * (never `--force`), so git refuses (409, with its message) while the worktree has
 * uncommitted or untracked files. The branch is kept. Refused (409) while a turn runs
 * or waits for an answer; 404 when the thread has no worktree. Removing a removed
 * worktree changes nothing.
 */
export const RemoveWorktreeRequest = Schema.Struct({ threadId: Schema.String });
export type RemoveWorktreeRequest = typeof RemoveWorktreeRequest.Type;
