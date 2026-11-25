import { createHash } from "node:crypto";
import { join } from "node:path";
import type { DiffFile } from "@wiki-agents/contracts/projects/model";
import { Effect, FileSystem, Stream } from "effect";
import { ProjectFilesError } from "./files.js";

const CONCURRENCY = 16;

/**
 * What a file in the working tree holds: sha256 of whether it is executable and its
 * content (or of `symlink:` and its target), null when it is gone. Not git's object id, so reading it needs no git and
 * no lock; it only has to change when the file does.
 */
const hashOf = Effect.fnUntraced(function* (directory: string, path: string) {
  const fs = yield* FileSystem.FileSystem;
  const absolute = join(directory, path);
  const info = yield* fs.lstat(absolute).pipe(Effect.orElseSucceed(() => undefined));
  if (info === undefined) return null;
  if (info.type === "SymbolicLink") return createHash("sha256").update(`symlink:${yield* fs.readLink(absolute)}`).digest("hex");
  // A submodule or nested repository: its commit shows in the diff, not its files.
  if (info.type !== "File") return `directory`;
  // The executable bit is part of what git commits.
  const hash = createHash("sha256").update((info.mode & 0o111) !== 0 ? "executable:" : "file:");
  yield* Stream.runForEach(fs.stream(absolute), (chunk) => Effect.sync(() => hash.update(chunk)));
  return hash.digest("hex");
});

/** Each path's content hash now, by path (see `DiffFile.hash`). */
export const contentHashes = (directory: string, paths: ReadonlyArray<string>) =>
  Effect.forEach(paths, (path) => Effect.map(hashOf(directory, path), (hash) => [path, hash] as const), { concurrency: CONCURRENCY }).pipe(
    Effect.map((entries) => new Map(entries)),
    Effect.mapError((cause) => new ProjectFilesError({ message: "Could not read the changed files", cause })),
  );

/** Adds each file's content hash (`DiffFile.hash`). */
export const withHashes = (directory: string, files: ReadonlyArray<DiffFile>) =>
  Effect.map(contentHashes(directory, files.map((file) => file.path)), (hashes) => files.map((file) => ({ ...file, hash: hashes.get(file.path) ?? null })));
