import type { GitStatus } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import type { GitDirectory } from "./git-directories.js";
import { branchStatus } from "./git/index.js";

/** The directory's `GitStatus`. */
export const gitStatus = (entry: GitDirectory) =>
  Effect.map(
    branchStatus(entry.directory),
    ({ branch, head, upstream, ahead, behind, pushRemote }): GitStatus => ({
      directory: entry.directory,
      ...(entry.worktree === undefined ? {} : { worktree: entry.worktree }),
      branch,
      head,
      upstream,
      ahead,
      behind,
      pushRemote,
    }),
  );
