import type { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { Effect } from "effect";
import { snapshot } from "../files.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/** The files as they are now become the baseline: the changed-file list starts again. Only changed files are read. */
export const reviewChanges = Effect.fn("reviewProjectChanges")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const repository = yield* ProjectRepository;
  const baseline = yield* snapshot(project.workingDirectories, yield* repository.baseline(project.id));
  yield* repository.replaceBaseline(project.id, baseline);
  return { files: baseline.length } satisfies ReviewChangesResponse;
});
