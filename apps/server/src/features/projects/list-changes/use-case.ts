import type { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { Effect } from "effect";
import { changedFiles } from "../changed-files.js";
import { fileKey } from "../files.js";
import { findProject } from "../find-project.js";
import { changedPaths, workTrees } from "../git.js";
import { ProjectRepository } from "../repository.js";

/**
 * Scans the working directories now: those in git compared with `HEAD` (without the
 * files ignored in the review), the rest with the stored baseline.
 */
export const listChanges = Effect.fn("listProjectChanges")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const repository = yield* ProjectRepository;
  const directories = project.workingDirectories;
  const inGit = yield* workTrees(directories);
  const gitDirectories = directories.filter((_, index) => inGit[index]);
  const outside = directories.filter((_, index) => !inGit[index]);
  const fromBaseline = outside.length === 0 ? [] : yield* changedFiles(outside, yield* repository.baseline(projectId));
  const ignored = new Set((yield* repository.ignoredFiles(projectId)).map(fileKey));
  const fromGit = (yield* Effect.forEach(gitDirectories, changedPaths, { concurrency: 4 })).flat().filter((change) => !ignored.has(fileKey(change)));
  const changes = [...fromGit, ...fromBaseline].sort((a, b) => a.directory.localeCompare(b.directory) || a.path.localeCompare(b.path));
  return { changes, gitDirectories } satisfies ListChangesResponse;
});
