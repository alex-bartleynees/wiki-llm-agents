import { Effect } from "effect";
import { InvalidProject } from "./errors.js";
import { findProject } from "./find-project.js";
import { workTrees } from "./git.js";
import { liveWorktrees } from "./worktrees.js";

/** A directory the Diff view shows with a branch: a working directory in git, or a thread's worktree. */
export interface GitDirectory {
  readonly directory: string;
  readonly worktree?: { readonly threadId: string; readonly branch: string };
}

/** The project's working directories in git, in its order, then its threads' worktrees that exist. */
export const gitDirectories = Effect.fnUntraced(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const inGit = yield* workTrees(project.workingDirectories);
  const own: Array<GitDirectory> = project.workingDirectories.filter((_, index) => inGit[index]).map((directory) => ({ directory }));
  const worktrees: Array<GitDirectory> = (yield* liveWorktrees(projectId)).map((worktree) => ({
    directory: worktree.directory,
    worktree: { threadId: worktree.threadId, branch: worktree.branch },
  }));
  return [...own, ...worktrees];
});

/** `directory` when it is one of `gitDirectories`; any other is refused. */
export const gitDirectory = Effect.fnUntraced(function* (projectId: string, directory: string) {
  const found = (yield* gitDirectories(projectId)).find((candidate) => candidate.directory === directory);
  if (found === undefined) return yield* new InvalidProject({ message: "Not one of the project's working directories in git, or a thread's worktree" });
  return found;
});
