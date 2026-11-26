import type { RemoveWorkingDirectoryRequest } from "@wiki-agents/contracts/projects/remove-working-directory/request";
import type { RemoveWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/remove-working-directory/response";
import { Effect } from "effect";
import { InvalidProject } from "../errors.js";
import { findProject } from "../find-project.js";
import { mainDirectory } from "../project-context.js";
import { ProjectRepository } from "../repository.js";

export const removeWorkingDirectory = Effect.fn("removeWorkingDirectory")(function* (projectId: string, request: RemoveWorkingDirectoryRequest) {
  const project = yield* findProject(projectId);
  if (mainDirectory(project) === request.path) return yield* new InvalidProject({ message: "The main directory can't be removed" });
  if (!project.workingDirectories.includes(request.path)) return yield* new InvalidProject({ message: "Not one of the project's working directories" });
  yield* (yield* ProjectRepository).removeWorkingDirectory(project.id, request.path);
  return { project: yield* findProject(project.id) } satisfies RemoveWorkingDirectoryResponse;
});
