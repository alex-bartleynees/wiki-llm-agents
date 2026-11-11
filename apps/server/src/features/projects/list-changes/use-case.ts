import type { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { Effect } from "effect";
import { changedFiles } from "../changed-files.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/** Scans the working directories now and compares them with the stored baseline. */
export const listChanges = Effect.fn("listProjectChanges")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const baseline = yield* (yield* ProjectRepository).baseline(projectId);
  const changes = yield* changedFiles(project.workingDirectories, baseline);
  return { changes } satisfies ListChangesResponse;
});
