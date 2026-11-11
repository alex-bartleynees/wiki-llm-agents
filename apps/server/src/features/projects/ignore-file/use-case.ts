import type { IgnoreFileRequest } from "@wiki-agents/contracts/projects/ignore-file/request";
import type { IgnoreFileResponse } from "@wiki-agents/contracts/projects/ignore-file/response";
import { Clock, Effect } from "effect";
import { findProject } from "../find-project.js";
import { checkIgnoredFile } from "../ignored-file.js";
import { ProjectRepository } from "../repository.js";

/** Sets a file aside in the project's diff review, whether or not it has changes now. */
export const ignoreFile = Effect.fn("ignoreProjectFile")(function* (projectId: string, request: IgnoreFileRequest) {
  const project = yield* findProject(projectId);
  const file = yield* checkIgnoredFile(project, request);
  const repository = yield* ProjectRepository;
  yield* repository.ignoreFile(project.id, file, yield* Clock.currentTimeMillis);
  return { ignored: yield* repository.ignoredFiles(project.id) } satisfies IgnoreFileResponse;
});
