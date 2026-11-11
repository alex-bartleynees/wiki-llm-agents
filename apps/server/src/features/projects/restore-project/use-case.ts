import type { RestoreProjectResponse } from "@wiki-agents/contracts/projects/restore-project/response";
import { Effect } from "effect";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

export const restoreProject = Effect.fn("restoreProject")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  if (project.archivedAt !== null) yield* (yield* ProjectRepository).setArchivedAt(project.id, null);
  return { project: { ...project, archivedAt: null } } satisfies RestoreProjectResponse;
});
