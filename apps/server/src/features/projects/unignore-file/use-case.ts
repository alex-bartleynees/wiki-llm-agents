import type { UnignoreFileRequest } from "@wiki-agents/contracts/projects/unignore-file/request";
import type { UnignoreFileResponse } from "@wiki-agents/contracts/projects/unignore-file/response";
import { Effect } from "effect";
import { findProject } from "../find-project.js";
import { checkIgnoredFile } from "../ignored-file.js";
import { ProjectRepository } from "../repository.js";

/** Brings a file back into the project's diff review. */
export const unignoreFile = Effect.fn("unignoreProjectFile")(function* (projectId: string, request: UnignoreFileRequest) {
  const project = yield* findProject(projectId);
  const file = yield* checkIgnoredFile(project, request);
  const repository = yield* ProjectRepository;
  yield* repository.unignoreFile(project.id, file);
  return { ignored: yield* repository.ignoredFiles(project.id) } satisfies UnignoreFileResponse;
});
