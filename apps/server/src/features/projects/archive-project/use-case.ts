import type { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { Clock, Effect } from "effect";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/** Keeps the first archive time when the project is archived already. */
export const archiveProject = Effect.fn("archiveProject")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  if (project.archivedAt !== null) return { project } satisfies ArchiveProjectResponse;
  const archivedAt = yield* Clock.currentTimeMillis;
  yield* (yield* ProjectRepository).setArchivedAt(project.id, archivedAt);
  return { project: { ...project, archivedAt } } satisfies ArchiveProjectResponse;
});
