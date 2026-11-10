import { Effect, Option } from "effect";
import { ProjectNotFound } from "./errors.js";
import { ProjectRepository } from "./repository.js";

export const findProject = Effect.fnUntraced(function* (projectId: string) {
  const project = yield* (yield* ProjectRepository).find(projectId);
  if (Option.isNone(project)) return yield* new ProjectNotFound({ projectId });
  return project.value;
});
