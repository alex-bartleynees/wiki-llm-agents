import { Schema } from "effect";

/** Work outside the vault: a project's own folders and threads, using the shared vault for notes. */
export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The shared vault the project's threads use. */
  vaultId: Schema.String,
  /** Main working directory first. Paths are canonical and belong to this machine. */
  workingDirectories: Schema.Array(Schema.String),
  /** A folder inside the shared vault for this project's notes. */
  notesFolder: Schema.NullOr(Schema.String),
  /**
   * When it was archived (milliseconds since the epoch); null while active. Archived
   * projects leave the project switchers and take no new threads.
   */
  archivedAt: Schema.NullOr(Schema.Number),
});
export type Project = typeof Project.Type;

export const FileChange = Schema.Struct({
  /** One of the project's working directories. */
  directory: Schema.String,
  /** Relative to `directory`, with `/` separators. */
  path: Schema.String,
  status: Schema.Literals(["created", "modified", "deleted"]),
});
export type FileChange = typeof FileChange.Type;

/**
 * How a file differs from `HEAD` in git. `untracked`: new and not yet added to git
 * (not ignored); `added`: new and staged.
 */
export const DiffStatus = Schema.Literals(["added", "modified", "deleted", "renamed", "untracked"]);
export type DiffStatus = typeof DiffStatus.Type;

/** A file's changes from `HEAD`: staged and unstaged together. */
export const DiffFile = Schema.Struct({
  /** Relative to the working directory, with `/` separators. */
  path: Schema.String,
  /** The path before a rename; null otherwise. */
  oldPath: Schema.NullOr(Schema.String),
  status: DiffStatus,
  /** Binary files have no diff and no line counts. */
  binary: Schema.Boolean,
  /** Lines added and removed, counted over the whole diff even when it is cut. */
  additions: Schema.Number,
  deletions: Schema.Number,
  /**
   * Unified diff, hunks only (`@@` headers and lines, three lines of context), cut to
   * a bounded size; `truncated` says when. Empty for binary files, empty files, and
   * mode-only changes.
   */
  diff: Schema.String,
  truncated: Schema.Boolean,
});
export type DiffFile = typeof DiffFile.Type;

/** One working directory's changes. */
export const DirectoryDiff = Schema.Struct({
  directory: Schema.String,
  /**
   * Whether the directory is in a git work tree. When it is, `files` compares it with
   * `HEAD`; when not, there is no diff and `changes` is the changed-file list
   * (compared with the baseline taken at registration or the last review).
   */
  git: Schema.Boolean,
  files: Schema.Array(DiffFile),
  changes: Schema.Array(FileChange),
});
export type DirectoryDiff = typeof DirectoryDiff.Type;
