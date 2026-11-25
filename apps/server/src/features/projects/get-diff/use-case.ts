import type { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import type { DirectoryDiff } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { changedFiles } from "../changed-files.js";
import { withHashes } from "../content-hashes.js";
import { LIST_BUDGET_CHARS, LIST_LIMITS } from "../diff-limits.js";
import { IGNORED } from "../files.js";
import { findProject } from "../find-project.js";
import { diffDirectory, headCommit, workTrees } from "../git/index.js";
import { mainDirectory } from "../project-context.js";
import { ProjectRepository } from "../repository.js";
import { liveWorktrees } from "../worktrees.js";

/**
 * A git directory's `HEAD`, read first, then its files with their content hashes, so a
 * commit of what was reviewed can check nothing moved since.
 */
const reviewable = (directory: string) =>
  Effect.gen(function* () {
    const head = yield* headCommit(directory);
    const files = yield* withHashes(directory, yield* diffDirectory(directory, LIST_LIMITS, LIST_BUDGET_CHARS, IGNORED));
    return { head, files };
  });

/**
 * Each working directory's changes: from git compared with `HEAD` where the directory
 * is in a work tree, else the changed-file list (compared with the baseline), without
 * diffs. Each directory lists the paths the user ignores in the review. Then each
 * thread's worktree that still exists, compared with its own `HEAD`, with the main
 * directory's ignored paths.
 */
export const getDiff = Effect.fn("getProjectDiff")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const repository = yield* ProjectRepository;
  const directories = project.workingDirectories;
  const inGit = yield* workTrees(directories);
  const outside = directories.filter((_, index) => !inGit[index]);
  const changes = outside.length === 0 ? [] : yield* changedFiles(outside, yield* repository.baseline(projectId));
  const ignoredFiles = yield* repository.ignoredFiles(projectId);
  const ignoredIn = (directory: string) => ignoredFiles.filter((file) => file.directory === directory).map((file) => file.path);
  const diffs = yield* Effect.forEach(
    directories,
    (directory, index): Effect.Effect<DirectoryDiff, Effect.Error<ReturnType<typeof reviewable>>, Effect.Services<ReturnType<typeof reviewable>>> => {
      const ignored = ignoredIn(directory);
      return inGit[index]
        ? reviewable(directory).pipe(Effect.map(({ head, files }) => ({ directory, git: true, head, files, changes: [], ignored })))
        : Effect.succeed({ directory, git: false, files: [], changes: changes.filter((change) => change.directory === directory), ignored });
    },
    { concurrency: 4 },
  );
  const ignoredInMain = ignoredIn(mainDirectory(project));
  const worktreeDiffs = yield* Effect.forEach(
    yield* liveWorktrees(projectId),
    (worktree) =>
      reviewable(worktree.directory).pipe(
        Effect.map(({ head, files }): DirectoryDiff => ({
          directory: worktree.directory,
          worktree: { threadId: worktree.threadId, branch: worktree.branch },
          git: true,
          head,
          files,
          changes: [],
          ignored: ignoredInMain,
        })),
      ),
    { concurrency: 4 },
  );
  return { directories: [...diffs, ...worktreeDiffs] } satisfies GetDiffResponse;
});
