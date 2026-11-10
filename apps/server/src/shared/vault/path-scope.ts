import { dirname, resolve } from "node:path";
import { Effect, FileSystem } from "effect";
import { isInside } from "./path-guard.js";

/** Glob characters and NUL: a pattern can't be checked as one path. */
const PATTERN = /[*?[\]{}\0]/;

/**
 * True when every path is inside one of `roots` once symlinks are resolved. A path
 * that doesn't exist yet is judged by its nearest existing folder, so a new file
 * through a symlink that leaves the roots is refused. Relative paths are from `cwd`;
 * a trailing `/*` or `/**` means the folder itself. `roots` must be canonical; an
 * empty list, a pattern, or anything unreadable is refused.
 */
export const pathsWithinRoots = Effect.fnUntraced(function* (roots: ReadonlyArray<string>, cwd: string, paths: ReadonlyArray<string>) {
  if (paths.length === 0) return false;
  const fs = yield* FileSystem.FileSystem;
  for (const root of roots) if ((yield* fs.realPath(root)) !== root) return false;
  for (const input of paths) {
    const path = input.replace(/\/\*\*?$/, "");
    if (path === "" || PATTERN.test(path)) return false;
    let candidate = resolve(cwd, path);
    while (!(yield* fs.exists(candidate))) {
      const parent = dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
    }
    const canonical = yield* fs.realPath(candidate);
    if (!roots.some((root) => isInside(root, canonical))) return false;
  }
  return true;
}, Effect.orElseSucceed(() => false));
