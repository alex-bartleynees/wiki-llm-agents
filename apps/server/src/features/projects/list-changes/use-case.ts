import type { FileChange } from "@wiki-agents/contracts/projects/model";
import type { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { Effect } from "effect";
import { fileKey, snapshot } from "../files.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/** Scans the working directories now and compares them with the stored baseline. */
export const listChanges = Effect.fn("listProjectChanges")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const before = yield* (yield* ProjectRepository).baseline(projectId);
  const after = yield* snapshot(project.workingDirectories, before);
  const old = new Map(before.map((file) => [fileKey(file), file]));
  const current = new Set(after.map(fileKey));
  const changes: Array<FileChange> = [];
  for (const file of after) {
    const previous = old.get(fileKey(file));
    if (previous?.hash !== file.hash) changes.push({ directory: file.directory, path: file.path, status: previous ? "modified" : "created" });
  }
  for (const file of before) if (!current.has(fileKey(file))) changes.push({ directory: file.directory, path: file.path, status: "deleted" });
  changes.sort((a, b) => a.directory.localeCompare(b.directory) || a.path.localeCompare(b.path));
  return { changes } satisfies ListChangesResponse;
});
