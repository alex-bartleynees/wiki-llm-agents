import type { GetFileDiffRequest } from "@wiki-agents/contracts/projects/get-file-diff/request";
import type { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
import { Effect } from "effect";
import { FileDiffNotFound, InvalidProject } from "../errors.js";
import { findProject } from "../find-project.js";
import { diffFile, workTrees } from "../git.js";
import { FILE_LIMITS, isInsidePath } from "../git-diff.js";

/**
 * One changed file's diff with the larger bound. Only inside one of the project's
 * working directories that is in git; any other directory or path is refused.
 */
export const getFileDiff = Effect.fn("getProjectFileDiff")(function* (projectId: string, request: GetFileDiffRequest) {
  const project = yield* findProject(projectId);
  if (!project.workingDirectories.includes(request.directory)) return yield* new InvalidProject({ message: "Not one of the project's working directories" });
  if (!isInsidePath(request.path)) return yield* new InvalidProject({ message: "The path must be relative and inside the working directory" });
  const [inGit] = yield* workTrees([request.directory]);
  if (!inGit) return yield* new InvalidProject({ message: "The working directory is not a git repository, so there is no diff" });
  const file = yield* diffFile(request.directory, request.path, FILE_LIMITS);
  if (file === undefined) return yield* new FileDiffNotFound({ path: request.path });
  return { file } satisfies GetFileDiffResponse;
});
