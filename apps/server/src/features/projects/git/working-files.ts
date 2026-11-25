import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { isWorkTree, runGit } from "./process.js";

/**
 * The entries git would show in `directory`: tracked plus untracked-but-not-ignored,
 * relative to `directory`. Undefined when git is missing, the folder is not in a work
 * tree, or the folder itself is ignored (git would list nothing).
 */
export const listWorkingFiles = Effect.fnUntraced(function* (directory: string) {
  if (!(yield* isWorkTree(directory))) return undefined;
  const listed = yield* runGit(directory, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listed.code !== 0) return undefined;
  // A path is listed once per merge stage while a conflict is unresolved.
  return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))];
});

export const holdsRepository = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.lstat(join(directory, ".git")).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
  });
