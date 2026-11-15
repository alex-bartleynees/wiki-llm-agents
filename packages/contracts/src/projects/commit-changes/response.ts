import { Schema } from "effect";
import { CommitSummary, GitStatus } from "../model.js";

export const CommitChangesResponse = Schema.Struct({
  commit: CommitSummary,
  /** What git and the commit hooks printed, cut to the last few thousand characters. */
  output: Schema.String,
  /** The directory's branch after the commit. */
  status: GitStatus,
});
export type CommitChangesResponse = typeof CommitChangesResponse.Type;
