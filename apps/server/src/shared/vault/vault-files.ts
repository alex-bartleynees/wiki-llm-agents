import { join, relative, sep } from "node:path";
import { Effect, FileSystem, Option, Semaphore } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { comparePaths } from "../paths.js";
import { isIgnoredName, isInside } from "./path-guard.js";

const WALK_CONCURRENCY = 16;

interface PendingDir {
  readonly real: string;
  readonly prefix: string;
}

/**
 * Every visible file in a vault as sorted vault-relative paths. Skips ignored names,
 * symlinks that are broken, leave the vault, or point into an ignored folder, and
 * folders already visited (so a symlink to a parent folder can't loop).
 */
export const listVaultFiles = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const realRoot = yield* fs.realPath(root);
  const files: Array<string> = [];
  const visited = new Set<string>([realRoot]);
  const readLimit = yield* Semaphore.make(WALK_CONCURRENCY);

  const readDir = (dir: string) =>
    readLimit.withPermits(1)(
      fs.readDirectoryEntries(dir).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([] as ReadonlyArray<FileSystem.DirectoryEntry>))),
    );

  let frontier: Array<PendingDir> = [{ real: realRoot, prefix: "" }];
  while (frontier.length > 0) {
    const listings = yield* Effect.forEach(frontier, (dir) => readDir(dir.real).pipe(Effect.map((entries) => ({ dir, entries }))), {
      concurrency: WALK_CONCURRENCY,
    });
    const nextFrontier: Array<PendingDir> = [];
    for (const { dir, entries } of listings) {
      const sorted = [...entries].sort((a, b) => comparePaths(a.name, b.name));
      for (const entry of sorted) {
        if (isIgnoredName(entry.name)) continue;
        const path = dir.prefix === "" ? entry.name : `${dir.prefix}/${entry.name}`;
        let real = join(dir.real, entry.name);
        let type = entry.type;
        if (type === "SymbolicLink" || type === "Unknown") {
          const target = yield* fs.realPath(real).pipe(Effect.option);
          if (Option.isNone(target) || !isInside(realRoot, target.value)) continue;
          if (relative(realRoot, target.value).split(sep).some(isIgnoredName)) continue;
          const info = yield* fs.stat(target.value).pipe(Effect.option);
          if (Option.isNone(info)) continue;
          real = target.value;
          type = info.value.type;
        }
        if (type === "Directory") {
          if (visited.has(real)) continue;
          visited.add(real);
          nextFrontier.push({ real, prefix: path });
        } else if (type === "File") {
          files.push(path);
        }
      }
    }
    frontier = nextFrontier;
  }

  return files.sort(comparePaths);
}) as (root: string) => Effect.Effect<Array<string>, PlatformError, FileSystem.FileSystem>;
