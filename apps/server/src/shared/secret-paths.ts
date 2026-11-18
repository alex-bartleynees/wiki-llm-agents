import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Effect, FileSystem } from "effect";
import { isInside } from "./vault/path-guard.js";

/**
 * Checks against the files that hold secrets (the stored secrets, their key, declared
 * secret files, files MCP servers' `${file:…}` references read), which no agent may
 * reach whatever its autonomy. The paths come from the secrets feature's
 * `SecretMaterial`, in both their written and canonical forms.
 */

/** A trailing `/*` or `/**` means the folder itself. */
const folderOf = (path: string) => path.replace(/\/\*\*?$/, "");

/** `path` with symlinks resolved; a part that doesn't exist yet is kept as written below its nearest existing folder. */
const canonical = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  let existing = path;
  let rest = "";
  while (!(yield* fs.exists(existing).pipe(Effect.orElseSucceed(() => false)))) {
    const parent = dirname(existing);
    if (parent === existing) return path;
    rest = rest === "" ? basename(existing) : join(basename(existing), rest);
    existing = parent;
  }
  const real = yield* fs.realPath(existing).pipe(Effect.orElseSucceed(() => existing));
  return rest === "" ? real : join(real, rest);
});

/**
 * True when one of `paths` (relative ones from `cwd`) is a protected path or inside
 * one, as written or once symlinks are resolved. With `searches`, a folder holding a
 * protected path counts too: searching it would read what's inside.
 */
export const reachesProtected = Effect.fnUntraced(function* (
  protectedPaths: ReadonlyArray<string>,
  cwd: string,
  paths: ReadonlyArray<string>,
  options: { readonly searches: boolean } = { searches: false },
) {
  if (protectedPaths.length === 0) return false;
  for (const input of paths) {
    const written = resolve(cwd, folderOf(input));
    for (const path of new Set([written, yield* canonical(written)])) {
      if (protectedPaths.some((secret) => isInside(secret, path) || (options.searches && isInside(path, secret)))) return true;
    }
  }
  return false;
});

/** How a command may write a protected path: as is, and from the home folder with `~`, `$HOME` or `${HOME}`. */
export const spellings = (path: string, home: string) => {
  if (home === "" || path === home || !isInside(home, path)) return [path];
  const rest = relative(home, path);
  return [path, `~/${rest}`, `$HOME/${rest}`, `\${HOME}/${rest}`];
};

/**
 * True when a shell command names a protected path. A best effort: a command can
 * reach a file without naming it (`cd` first, a glob, a variable), which only a
 * sandbox that denies the read can stop.
 */
export const commandNamesProtected = (protectedPaths: ReadonlyArray<string>, command: string, home: string = homedir()) =>
  protectedPaths.some((path) => spellings(path, home).some((spelling) => command.includes(spelling)));

/** A protected path as the user would recognise it: from the home folder with `~`. */
export const displayPath = (path: string, home: string = homedir()) => (home !== "" && path !== home && isInside(home, path) ? `~/${relative(home, path)}` : path);
