import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import type { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { Clock, Effect, FileSystem, Option } from "effect";
import { resolveInVault } from "../../../shared/vault/path-guard.js";
import { VaultRepository } from "../../vaults/repository.js";
import { InvalidProject } from "../errors.js";
import { snapshot } from "../files.js";
import { ProjectRepository } from "../repository.js";
import { absoluteDirectory, canonicalDirectory } from "../working-directory.js";

const invalid = (message: string) => new InvalidProject({ message });

/**
 * Checks everything first and only then creates missing folders, so a rejected
 * request leaves nothing behind. The baseline for the changed-file list is the
 * files as they are now.
 */
export const registerProject = Effect.fn("registerProject")(function* (request: RegisterProjectRequest) {
  const name = request.name.trim();
  const notesFolder = request.notesFolder?.trim() || null;
  if (!name) return yield* invalid("Provide a name");
  if (request.workingDirectories.length === 0 && notesFolder === null) return yield* invalid("Provide a working directory or a notes folder");
  const vault = yield* (yield* VaultRepository).firstRegistered;
  if (Option.isNone(vault)) return yield* invalid("Register the shared vault before registering projects");
  const fs = yield* FileSystem.FileSystem;

  let notesPath: string | null = null;
  if (notesFolder !== null) {
    const resolved = yield* resolveInVault(vault.value.rootPath, notesFolder).pipe(Effect.mapError(() => invalid("Notes folder must exist inside the shared vault")));
    const info = yield* fs.stat(resolved.absolute).pipe(Effect.mapError(() => invalid("Cannot read notes folder")));
    if (info.type !== "Directory") return yield* invalid("Notes folder must be a directory");
    notesPath = resolved.absolute;
  }

  /**
   * A vault-only project (no repo, e.g. a move plan) works in its notes folder:
   * threads run there and its changed files and diffs are the notes folder's.
   */
  const inputs = request.workingDirectories.length > 0 ? request.workingDirectories : [notesPath!];

  /** Each input in order: its canonical path if it exists, else the path to create. */
  const planned: Array<{ readonly path: string; readonly exists: boolean }> = [];
  for (const input of inputs) {
    const path = yield* absoluteDirectory(input);
    const exists = yield* fs.exists(path).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
    if (!exists) {
      if (request.createDirectories !== true) return yield* invalid("Working directory not found: " + path);
      // mkdir -p only works below a directory.
      let parent = dirname(path);
      while (!(yield* fs.exists(parent).pipe(Effect.orElseSucceed(() => false)))) parent = dirname(parent);
      const info = yield* fs.stat(parent).pipe(Effect.mapError(() => invalid("Cannot create working directory: " + path)));
      if (info.type !== "Directory") return yield* invalid("Cannot create working directory: " + path);
      planned.push({ path, exists: false });
      continue;
    }
    planned.push({ path: yield* canonicalDirectory(path), exists: true });
  }

  const existing = [...new Set(planned.filter((entry) => entry.exists).map((entry) => entry.path))];
  // Folders about to be created are empty, so the existing ones make the whole baseline.
  const baseline = yield* snapshot(existing).pipe(Effect.mapError((error) => invalid(error.message)));

  const directories: Array<string> = [];
  for (const entry of planned) {
    if (!entry.exists) yield* fs.makeDirectory(entry.path, { recursive: true }).pipe(Effect.mapError(() => invalid("Cannot create working directory: " + entry.path)));
    const canonical = entry.exists ? entry.path : yield* fs.realPath(entry.path).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + entry.path)));
    if (!directories.includes(canonical)) directories.push(canonical);
  }

  const project = { id: randomUUID(), name, vaultId: vault.value.id, workingDirectories: directories, notesFolder, archivedAt: null };
  yield* (yield* ProjectRepository).insert(project, baseline, yield* Clock.currentTimeMillis);
  return { project } satisfies RegisterProjectResponse;
});
