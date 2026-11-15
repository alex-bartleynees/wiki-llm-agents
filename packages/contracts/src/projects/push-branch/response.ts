import { Schema } from "effect";
import { GitStatus } from "../model.js";

export const PushBranchResponse = Schema.Struct({
  /** What git and the remote printed, cut to the last few thousand characters. */
  output: Schema.String,
  /** The directory's branch after the push. */
  status: GitStatus,
});
export type PushBranchResponse = typeof PushBranchResponse.Type;
