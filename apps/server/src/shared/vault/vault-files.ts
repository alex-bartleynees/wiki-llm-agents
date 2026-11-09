import { join, relative, sep } from "node:path";
import { Effect, FileSystem, Option } from "effect";
import { isIgnoredName, isInside } from "./path-guard.js";

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

  const walk = (dir: string, prefix: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.orElseSucceed(() => []));
      for (const entry of entries) {
        if (isIgnoredName(entry.name)) continue;
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        let real = join(dir, entry.name);
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
          yield* walk(real, path);
        } else if (type === "File") {
          files.push(path);
        }
      }
    });

  yield* walk(realRoot, "");
  return files.sort((a, b) => a.localeCompare(b));
});
