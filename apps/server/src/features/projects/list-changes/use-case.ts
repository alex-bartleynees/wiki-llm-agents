import type { FileChange } from "@wiki-agents/contracts/projects/model";
import type { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { Effect } from "effect";
import { snapshot } from "../files.js";
import { findProject } from "../find-project.js";
import { type FileVersion, ProjectRepository } from "../repository.js";

const key = (file: FileVersion) => JSON.stringify([file.directory, file.path]);

/** Scans the working directories now and compares them with the stored baseline. */
export const listChanges = Effect.fn("listProjectChanges")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const before = yield* (yield* ProjectRepository).baseline(projectId);
  const after = yield* snapshot(project.workingDirectories);
  const old = new Map(before.map((file) => [key(file), file]));
  const current = new Set(after.map(key));
  const changes: Array<FileChange> = [];
  for (const file of after) {
    const previous = old.get(key(file));
    if (previous?.hash !== file.hash) changes.push({ directory: file.directory, path: file.path, status: previous ? "modified" : "created" });
  }
  for (const file of before) if (!current.has(key(file))) changes.push({ directory: file.directory, path: file.path, status: "deleted" });
  changes.sort((a, b) => a.directory.localeCompare(b.directory) || a.path.localeCompare(b.path));
  return { changes } satisfies ListChangesResponse;
});
