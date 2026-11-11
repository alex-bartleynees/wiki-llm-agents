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
