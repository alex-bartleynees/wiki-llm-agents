import type { AddWorkingDirectoryRequest } from "@wiki-agents/contracts/projects/add-working-directory/request";
import type { AddWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/add-working-directory/response";
import { Effect, FileSystem } from "effect";
import { isInside } from "../../../shared/vault/path-guard.js";
import { InvalidProject } from "../errors.js";
import { snapshot } from "../files.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";
import { absoluteDirectory, canonicalDirectory } from "../working-directory.js";

const invalid = (message: string) => new InvalidProject({ message });

export const addWorkingDirectory = Effect.fn("addWorkingDirectory")(function* (projectId: string, request: AddWorkingDirectoryRequest) {
  const project = yield* findProject(projectId);
  const path = yield* absoluteDirectory(request.path);
  const exists = yield* (yield* FileSystem.FileSystem).exists(path).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
  if (!exists) return yield* invalid("Working directory not found: " + path);
  const directory = yield* canonicalDirectory(path);
  if (project.workingDirectories.includes(directory)) return { project } satisfies AddWorkingDirectoryResponse;
  const overlapping = project.workingDirectories.find((existing) => isInside(existing, directory) || isInside(directory, existing));
  if (overlapping !== undefined) return yield* invalid(`Overlaps the working directory ${overlapping}`);

  const baseline = yield* snapshot([directory]).pipe(Effect.mapError((error) => invalid(error.message)));
  yield* (yield* ProjectRepository).addWorkingDirectory(project.id, directory, baseline);
  return { project: yield* findProject(project.id) } satisfies AddWorkingDirectoryResponse;
});
