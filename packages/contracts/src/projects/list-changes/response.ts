import { Schema } from "effect";
import { FileChange } from "../model.js";

export const ListChangesResponse = Schema.Struct({
  /**
   * Changed files in every working directory, sorted by directory and path. A
   * directory in a git work tree lists what differs from `HEAD` (as the diff does,
   * leaving out the files the user ignores in the review), so committing clears it.
   * Any other directory lists what differs from the baseline, taken at registration
   * and whenever the changes are marked reviewed, across restarts.
   */
  changes: Schema.Array(FileChange),
  /** The working directories compared with `HEAD`; "mark reviewed" leaves them as they are. */
  gitDirectories: Schema.Array(Schema.String),
});
export type ListChangesResponse = typeof ListChangesResponse.Type;
