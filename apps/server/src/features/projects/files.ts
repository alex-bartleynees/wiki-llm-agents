import { createHash } from "node:crypto";
import { join } from "node:path";
import { Data, Effect, FileSystem, Stream } from "effect";
import type { FileVersion } from "./repository.js";

export class ProjectFilesError extends Data.TaggedError("ProjectFilesError")<{ readonly message: string; readonly cause?: unknown }> {}

/**
 * Version-control metadata and generated dependency/build/cache trees. Other dotfiles
 * (e.g. `.env`) are reported.
 */
const IGNORED = new Set([
  ".git", ".hg", ".svn", "node_modules", "result", ".svelte-kit", ".direnv", ".venv", "venv", "__pycache__",
  ".cache", ".next", ".turbo", "dist", "target", "obj", ".gradle", ".idea", ".vs",
]);

/** A scan stops here rather than hashing a home directory or a whole disk. */
export const MAX_PROJECT_FILES = 20_000;

const hashFile = (fs: FileSystem.FileSystem, path: string) =>
  Effect.gen(function* () {
    const hash = createHash("sha256");
    yield* Stream.runForEach(fs.stream(path), (chunk) => Effect.sync(() => hash.update(chunk)));
    return hash.digest("hex");
  });

/**
 * Every file in the working directories with its SHA-256. Symlinks are not followed.
 * Fails, rather than reporting false deletions, when a folder is unreadable or has
 * moved, and when there are more than `MAX_PROJECT_FILES` files.
 */
export const snapshot = Effect.fnUntraced(function* (directories: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const files: Array<FileVersion> = [];
  const fail = (message: string) => (cause: unknown) => new ProjectFilesError({ message, cause });
  for (const directory of directories) {
    if ((yield* fs.realPath(directory).pipe(Effect.mapError(fail("Could not scan " + directory)))) !== directory) {
      return yield* new ProjectFilesError({ message: "A working directory has moved or become a symlink: " + directory });
    }
    const walk = (relative: string): Effect.Effect<void, ProjectFilesError> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectoryEntries(join(directory, relative)).pipe(Effect.mapError(fail("Could not scan " + directory)));
        for (const entry of entries) {
          if (IGNORED.has(entry.name)) continue;
          const path = relative === "" ? entry.name : relative + "/" + entry.name;
          if (entry.type === "Directory") yield* walk(path);
          else if (entry.type === "File") {
            if (files.length >= MAX_PROJECT_FILES) {
              return yield* new ProjectFilesError({ message: `More than ${MAX_PROJECT_FILES} files in the working directories; choose narrower folders` });
            }
            files.push({ directory, path, hash: yield* hashFile(fs, join(directory, path)).pipe(Effect.mapError(fail("Could not read " + path))) });
          }
        }
      });
    yield* walk("");
  }
  return files;
});
