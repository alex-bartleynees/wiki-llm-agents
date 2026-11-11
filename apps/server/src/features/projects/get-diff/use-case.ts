import type { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import type { DirectoryDiff } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { changedFiles } from "../changed-files.js";
import { findProject } from "../find-project.js";
import { diffDirectory, workTrees } from "../git.js";
import { LIST_LIMITS } from "../git-diff.js";
import { ProjectRepository } from "../repository.js";

/**
 * Each working directory's changes: from git compared with `HEAD` where the directory
 * is in a work tree, else the changed-file list (compared with the baseline), without diffs.
 */
export const getDiff = Effect.fn("getProjectDiff")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const directories = project.workingDirectories;
  const inGit = yield* workTrees(directories);
  const outside = directories.filter((_, index) => !inGit[index]);
  const changes = outside.length === 0 ? [] : yield* changedFiles(outside, yield* (yield* ProjectRepository).baseline(projectId));
  const diffs = yield* Effect.forEach(
    directories,
    (directory, index): Effect.Effect<DirectoryDiff, Effect.Error<ReturnType<typeof diffDirectory>>> =>
      inGit[index]
        ? diffDirectory(directory, LIST_LIMITS).pipe(Effect.map((files) => ({ directory, git: true, files, changes: [] })))
        : Effect.succeed({ directory, git: false, files: [], changes: changes.filter((change) => change.directory === directory) }),
    { concurrency: 4 },
  );
  return { directories: diffs } satisfies GetDiffResponse;
});
