import { isAbsolute, join, relative, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { InvalidVaultPath, VaultFileNotFound } from "./errors.js";

/**
 * Names hidden from the tree and refused by the guard: every dot-name (as Obsidian
 * does: `.git`, `.obsidian`, `.trash`, `.stfolder`, editor folders) and Syncthing
 * conflict copies.
 */
export const isIgnoredName = (name: string): boolean =>
  name.startsWith(".") || name.includes(".sync-conflict-");

/**
 * Normalises a vault-relative path (`a//b/./c.md` → `a/b/c.md`). Returns undefined
 * for anything that could leave the vault or names an ignored file: absolute paths,
 * `..` segments, NUL bytes, ignored names.
 */
export const normaliseVaultPath = (input: string): string | undefined => {
  if (input.includes("\0") || input.startsWith("/") || isAbsolute(input)) return undefined;
  const segments = input.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return undefined;
  if (segments.some((segment) => segment === ".." || isIgnoredName(segment))) return undefined;
  return segments.join("/");
};

/** True when `target` is `root` or inside it. Both must be absolute and canonical. */
export const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

/** True when no segment of a vault-relative path (OS separators) is ignored. */
const isVisible = (rel: string) => rel === "" || rel.split(sep).every((name) => !isIgnoredName(name));

/**
 * Resolves a vault-relative path to an absolute one, following symlinks, and refuses
 * anything whose real location is outside the vault or ignored.
 */
export const resolveInVault = (root: string, input: string) =>
  Effect.gen(function* () {
    const path = normaliseVaultPath(input);
    if (path === undefined) return yield* new InvalidVaultPath({ path: input });
    const fs = yield* FileSystem.FileSystem;
    const realRoot = yield* fs.realPath(root);
    const absolute = yield* fs.realPath(join(realRoot, path)).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => new VaultFileNotFound({ path })),
    );
    if (!isInside(realRoot, absolute) || !isVisible(relative(realRoot, absolute))) {
      return yield* new InvalidVaultPath({ path: input });
    }
    return { path, absolute };
  });

/**
 * Where a file that doesn't exist yet would go, for writing it: the nearest folder
 * that exists on the way must really be inside the vault (symlinks resolved) and
 * visible. Fails with `InvalidVaultPath` otherwise.
 */
export const resolveNewInVault = (root: string, input: string) =>
  Effect.gen(function* () {
    const path = normaliseVaultPath(input);
    if (path === undefined) return yield* new InvalidVaultPath({ path: input });
    const fs = yield* FileSystem.FileSystem;
    const realRoot = yield* fs.realPath(root);
    const segments = path.split("/");
    for (let kept = segments.length - 1; kept >= 0; kept -= 1) {
      const ancestor = join(realRoot, ...segments.slice(0, kept));
      const real = yield* fs.realPath(ancestor).pipe(Effect.option);
      if (real._tag === "None") continue;
      if (!isInside(realRoot, real.value) || !isVisible(relative(realRoot, real.value))) break;
      return join(real.value, ...segments.slice(kept));
    }
    return yield* new InvalidVaultPath({ path: input });
  });
