import { Schema } from "effect";

/** A file to commit, as you reviewed it. */
export const CommitFile = Schema.Struct({
  /** Relative to the directory, as `get-diff` gave it. A rename is two files: the new path and the old one (hash null). */
  path: Schema.String,
  /** `DiffFile.hash` from the review: what the file held, or null when deleted. */
  hash: Schema.NullOr(Schema.String),
});
export type CommitFile = typeof CommitFile.Type;

/**
 * POST /api/projects/:projectId/git/commit with this body. Commits exactly these
 * files, whole, as they are in the working tree, and nothing else in git's index.
 * Refused (409) when `HEAD` or any file changed since the review.
 */
export const CommitChangesRequest = Schema.Struct({
  /** One of the project's working directories in git, or a thread's worktree directory. */
  directory: Schema.String,
  /** `DirectoryDiff.head` from the review. */
  head: Schema.NullOr(Schema.String),
  message: Schema.String,
  files: Schema.Array(CommitFile),
});
export type CommitChangesRequest = typeof CommitChangesRequest.Type;
