import type { FileChange } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { fileKey, snapshot } from "./files.js";
import type { FileVersion } from "./repository.js";

/**
 * Scans `directories` now and compares them with `baseline` (only its files in those
 * directories count), sorted by directory and path.
 */
export const changedFiles = Effect.fnUntraced(function* (directories: ReadonlyArray<string>, baseline: ReadonlyArray<FileVersion>) {
  const inScope = new Set(directories);
  const before = baseline.filter((file) => inScope.has(file.directory));
  const after = yield* snapshot(directories, before);
  const old = new Map(before.map((file) => [fileKey(file), file]));
  const current = new Set(after.map(fileKey));
  const changes: Array<FileChange> = [];
  for (const file of after) {
    const previous = old.get(fileKey(file));
    if (previous?.hash !== file.hash) changes.push({ directory: file.directory, path: file.path, status: previous ? "modified" : "created" });
  }
  for (const file of before) if (!current.has(fileKey(file))) changes.push({ directory: file.directory, path: file.path, status: "deleted" });
  changes.sort((a, b) => a.directory.localeCompare(b.directory) || a.path.localeCompare(b.path));
  return changes;
});
