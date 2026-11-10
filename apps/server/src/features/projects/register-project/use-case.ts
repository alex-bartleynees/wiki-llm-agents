import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import type { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { Clock, Effect, FileSystem, Option } from "effect";
import { expandHome } from "../../../shared/paths.js";
import { isInside, resolveInVault } from "../../../shared/vault/path-guard.js";
import { VaultRepository } from "../../vaults/repository.js";
import { InvalidProject } from "../errors.js";
import { snapshot } from "../files.js";
import { ProjectRepository } from "../repository.js";

const invalid = (message: string) => new InvalidProject({ message });


/** `/`, `/home` or the home folder itself: far too much to scan, and never one project. */
const tooBroad = (path: string) => isInside(path, homedir());

/**
 * Checks everything first and only then creates missing folders, so a rejected
 * request leaves nothing behind. The baseline for the changed-file list is the
 * files as they are now.
 */
export const registerProject = Effect.fn("registerProject")(function* (request: RegisterProjectRequest) {
  const name = request.name.trim();
  if (!name || request.workingDirectories.length === 0) return yield* invalid("Provide a name and at least one working directory");
  const vault = yield* (yield* VaultRepository).firstRegistered;
  if (Option.isNone(vault)) return yield* invalid("Register the shared vault before registering projects");
  const fs = yield* FileSystem.FileSystem;

  const notesFolder = request.notesFolder?.trim() || null;
  if (notesFolder !== null) {
    const resolved = yield* resolveInVault(vault.value.rootPath, notesFolder).pipe(Effect.mapError(() => invalid("Notes folder must exist inside the shared vault")));
    const info = yield* fs.stat(resolved.absolute).pipe(Effect.mapError(() => invalid("Cannot read notes folder")));
    if (info.type !== "Directory") return yield* invalid("Notes folder must be a directory");
  }

  /** Each input in order: its canonical path if it exists, else the path to create. */
  const planned: Array<{ readonly path: string; readonly exists: boolean }> = [];
  for (const input of request.workingDirectories) {
    const expanded = expandHome(input.trim());
    if (!isAbsolute(expanded)) return yield* invalid("Working directories must be absolute paths");
    const path = resolve(expanded);
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
    const canonical = yield* fs.realPath(path).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
    const info = yield* fs.stat(canonical).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
    if (info.type !== "Directory") return yield* invalid("Not a directory: " + path);
    if (tooBroad(canonical)) return yield* invalid("Too broad for a working directory: " + path);
    planned.push({ path: canonical, exists: true });
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

  const project = { id: randomUUID(), name, vaultId: vault.value.id, workingDirectories: directories, notesFolder };
  yield* (yield* ProjectRepository).insert(project, baseline, yield* Clock.currentTimeMillis);
  return { project } satisfies RegisterProjectResponse;
});
