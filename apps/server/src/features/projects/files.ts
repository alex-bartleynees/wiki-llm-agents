import { createHash } from "node:crypto";
import { join } from "node:path";
import { ByteSize, Data, Effect, FileSystem, Option, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { holdsRepository, listWorkingFiles } from "./git/index.js";
import type { FileVersion } from "./repository.js";

export class ProjectFilesError extends Data.TaggedError("ProjectFilesError")<{ readonly message: string; readonly cause?: unknown }> {}

/**
 * Version-control metadata and generated dependency/build/cache trees, skipped even
 * when git tracks them. Other dotfiles (e.g. `.env`) are reported.
 */
export const IGNORED = new Set([
  ".git", ".hg", ".svn", "node_modules", "result", ".svelte-kit", ".direnv", ".venv", "venv", "__pycache__",
  ".cache", ".next", ".turbo", "dist", "target", "obj", ".gradle", ".idea", ".vs",
  ".npm", ".pnpm-store", ".yarn", ".angular", ".nx", ".output", ".nuxt", ".parcel-cache", ".pytest_cache", ".mypy_cache",
]);

/** Files read at once: enough to keep the disk busy without running out of file handles. */
const CONCURRENCY = 32;
/** Smaller files are read whole; larger ones are streamed, so memory stays bounded. */
const READ_WHOLE = 1024n * 1024n;
/**
 * A file modified this close to the scan may be written again within the same
 * timestamp, so its size and time don't prove it unchanged next time (git's "racy" files).
 */
const RACY_MS = 2000;

const scanError = (message: string) => (cause: unknown) => new ProjectFilesError({ message, cause });

interface ListedFile {
  readonly path: string;
  readonly info?: FileSystem.File.Info;
}

/**
 * Every regular file below `directory` (relative, `/`-separated), skipping `IGNORED`
 * names and, inside a git work tree, whatever `.gitignore` excludes. Nested
 * repositories and submodules are listed by their own git. Symlinks are not followed.
 */
const listFiles = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const files: Array<ListedFile> = [];
  const prefixed = (relative: string, name: string) => (relative === "" ? name : relative + "/" + name);

  /** `askGit`: the folder may be in a work tree (the top, or a folder holding `.git`). */
  const walk = (relative: string, askGit: boolean): Effect.Effect<void, ProjectFilesError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> =>
    Effect.gen(function* () {
      const absolute = join(directory, relative);
      const listing = askGit ? yield* listWorkingFiles(absolute) : undefined;
      if (listing !== undefined) {
        const paths = listing
          .map((entry) => (entry.endsWith("/") ? entry.slice(0, -1) : entry))
          // An uninitialised submodule lists itself as `./`.
          .filter((entry) => entry !== "." && entry !== "")
          .map((entry) => prefixed(relative, entry))
          .filter((path) => !path.split("/").some((part) => IGNORED.has(part)));
        // Missing (tracked but deleted) is absent, as it would be from a walk.
        const infos = yield* Effect.forEach(
          paths,
          (path) => fs.lstat(join(directory, path)).pipe(Effect.orElseSucceed(() => undefined)),
          { concurrency: CONCURRENCY },
        );
        const nested: Array<string> = [];
        paths.forEach((path, index) => {
          const info = infos[index];
          if (info?.type === "File") files.push({ path, info });
          else if (info?.type === "Directory") nested.push(path);
        });
        for (const path of nested) yield* walk(path, true);
        return;
      }
      const entries = yield* fs.readDirectoryEntries(absolute).pipe(Effect.mapError(scanError("Could not scan " + directory)));
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        const path = prefixed(relative, entry.name);
        if (entry.type === "File") files.push({ path });
        else if (entry.type === "Directory") {
          yield* walk(path, yield* holdsRepository(join(directory, path)));
        }
      }
    });

  yield* walk("", true);
  return files;
});

const hashFile = Effect.fnUntraced(function* (path: string, size: bigint) {
  const fs = yield* FileSystem.FileSystem;
  const hash = createHash("sha256");
  if (size <= READ_WHOLE) hash.update(yield* fs.readFile(path));
  else yield* Stream.runForEach(fs.stream(path), (chunk) => Effect.sync(() => hash.update(chunk)));
  return hash.digest("hex");
});

/** `directory` and `path` as one map key. */
export const fileKey = (file: { readonly directory: string; readonly path: string }) => file.directory + "\0" + file.path;

/**
 * Every file in the working directories with its SHA-256, size and modification time.
 * Inside a git work tree, gitignored files are left out, so dependency caches and
 * build output don't count. A file whose size and time match its entry in `previous`
 * keeps that hash without being read, so a rescan reads only what changed. Fails,
 * rather than reporting false deletions, when a folder is unreadable or has moved.
 */
export const snapshot = (directories: ReadonlyArray<string>, previous: ReadonlyArray<FileVersion> = []) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const started = yield* Effect.sync(() => Date.now());
    const known = new Map(previous.map((file) => [fileKey(file), file]));
    const listed: Array<{ readonly directory: string; readonly path: string; readonly info?: FileSystem.File.Info }> = [];
    for (const directory of directories) {
      const canonical = yield* fs.realPath(directory).pipe(Effect.mapError(scanError("Could not scan " + directory)));
      if (canonical !== directory) return yield* new ProjectFilesError({ message: "A working directory has moved or become a symlink: " + directory });
      for (const entry of yield* listFiles(directory)) listed.push({ directory, path: entry.path, ...(entry.info === undefined ? {} : { info: entry.info }) });
    }
    const versions = yield* Effect.forEach(
      listed,
      ({ directory, path, info: preInfo }) =>
        Effect.gen(function* () {
          const absolute = join(directory, path);
          // Gone between listing and reading: as if it had gone a moment earlier.
          const info = preInfo ?? (yield* fs.lstat(absolute).pipe(Effect.orElseSucceed(() => undefined)));
          if (info === undefined || info.type !== "File") return undefined;
          const size = ByteSize.toBigInt(info.size);
          const modifiedAt = Option.getOrThrow(info.mtime).getTime();
          const before = known.get(fileKey({ directory, path }));
          const unchanged = before !== undefined && before.modifiedAt !== null && before.size === Number(size) && Math.floor(before.modifiedAt) === modifiedAt;
          const hash = unchanged
            ? before.hash
            : yield* hashFile(absolute, size).pipe(
                Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
                Effect.mapError(scanError("Could not read " + path)),
              );
          if (hash === undefined) return undefined;
          const racy = modifiedAt > started - RACY_MS;
          return { directory, path, hash, size: Number(size), modifiedAt: racy ? null : modifiedAt } satisfies FileVersion;
        }),
      { concurrency: CONCURRENCY },
    );
    return versions.filter((version) => version !== undefined);
  });
