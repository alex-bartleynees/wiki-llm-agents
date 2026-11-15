import { Schema } from "effect";
import { GitStatus } from "../model.js";

export const GetGitStatusResponse = Schema.Struct({
  /** Each working directory in git, in the project's order, then each thread's worktree. */
  directories: Schema.Array(GitStatus),
});
export type GetGitStatusResponse = typeof GetGitStatusResponse.Type;
