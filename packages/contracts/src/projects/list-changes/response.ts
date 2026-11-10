import { Schema } from "effect";
import { FileChange } from "../model.js";

export const ListChangesResponse = Schema.Struct({
  /**
   * Files that differ from the baseline (taken at registration, then whenever the
   * changes are marked reviewed), across restarts and every working directory.
   */
  changes: Schema.Array(FileChange),
});
export type ListChangesResponse = typeof ListChangesResponse.Type;
