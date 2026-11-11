import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Data, Effect } from "effect";
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
const READ_WHOLE = 1024 * 1024;
/**
 * A file modified this close to the scan may be written again within the same
 * timestamp, so its size and time don't prove it unchanged next time (git's "racy" files).
 */
const RACY_MS = 2000;

class ScanError extends Error {}

/** Runs `work` over `items`, `CONCURRENCY` at a time, keeping their order. */
const mapLimited = async <A, B>(items: ReadonlyArray<A>, work: (item: A) => Promise<B>): Promise<Array<B>> => {
  const results = new Array<B>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
};

const git = (directory: string, args: ReadonlyArray<string>) =>
  new Promise<{ readonly code: number | null; readonly stdout: string }>((resolve) =>
    execFile("git", ["-C", directory, ...args], { maxBuffer: 1024 * 1024 * 1024, encoding: "utf8" }, (error, stdout) =>
      resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout }),
    ),
  );

/**
 * The entries git would show in `directory`: tracked plus untracked-but-not-ignored,
 * relative to `directory`. Undefined when git is missing, the folder is not in a work
 * tree, or the folder itself is ignored (git would list nothing).
 */
const gitListing = async (directory: string): Promise<ReadonlyArray<string> | undefined> => {
  // Exit 0 means ignored; 1 means not ignored; anything else, not a work tree.
  if ((await git(directory, ["check-ignore", "-q", "."])).code !== 1) return undefined;
  const listed = await git(directory, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listed.code !== 0) return undefined;
  // A path is listed once per merge stage while a conflict is unresolved.
  return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))];
};

/**
 * Every regular file below `directory` (relative, `/`-separated), skipping `IGNORED`
 * names and, inside a git work tree, whatever `.gitignore` excludes. Nested
 * repositories and submodules are listed by their own git. Symlinks are not followed.
 */
const listFiles = async (directory: string): Promise<Array<string>> => {
  const files: Array<string> = [];
  const prefixed = (relative: string, name: string) => (relative === "" ? name : relative + "/" + name);

  /** `askGit`: the folder may be in a work tree (the top, or a folder holding `.git`). */
  const walk = async (relative: string, askGit: boolean): Promise<void> => {
    const absolute = join(directory, relative);
    const listing = askGit ? await gitListing(absolute) : undefined;
    if (listing !== undefined) {
      const paths = listing
        .map((entry) => (entry.endsWith("/") ? entry.slice(0, -1) : entry))
        // An uninitialised submodule lists itself as `./`.
        .filter((entry) => entry !== "." && entry !== "")
        .map((entry) => prefixed(relative, entry))
        .filter((path) => !path.split("/").some((part) => IGNORED.has(part)));
      // Missing (tracked but deleted) is absent, as it would be from a walk.
      const kinds = await mapLimited(paths, (path) =>
        lstat(join(directory, path)).then((info) => (info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"), () => "other"),
      );
      const nested: Array<string> = [];
      paths.forEach((path, index) => {
        if (kinds[index] === "file") files.push(path);
        else if (kinds[index] === "directory") nested.push(path);
      });
      for (const path of nested) await walk(path, true);
      return;
    }
    const entries = await readdir(absolute, { withFileTypes: true }).catch((cause: unknown) => {
      throw new ScanError("Could not scan " + directory, { cause });
    });
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const path = prefixed(relative, entry.name);
      if (entry.isFile()) files.push(path);
      else if (entry.isDirectory()) await walk(path, await lstat(join(directory, path, ".git")).then(() => true, () => false));
    }
  };

  await walk("", true);
  return files;
};

const hashFile = async (path: string, size: number) => {
  const hash = createHash("sha256");
  if (size <= READ_WHOLE) hash.update(await readFile(path));
  else await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};

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
  Effect.tryPromise({
    try: async () => {
      const started = Date.now();
      const known = new Map(previous.map((file) => [fileKey(file), file]));
      const listed: Array<{ readonly directory: string; readonly path: string }> = [];
      for (const directory of directories) {
        const canonical = await realpath(directory).catch((cause: unknown) => {
          throw new ScanError("Could not scan " + directory, { cause });
        });
        if (canonical !== directory) throw new ScanError("A working directory has moved or become a symlink: " + directory);
        for (const path of await listFiles(directory)) listed.push({ directory, path });
      }
      const versions = await mapLimited(listed, async ({ directory, path }): Promise<FileVersion | undefined> => {
        const absolute = join(directory, path);
        // Gone between listing and reading: as if it had gone a moment earlier.
        const info = await lstat(absolute).catch(() => undefined);
        if (info === undefined || !info.isFile()) return undefined;
        const before = known.get(fileKey({ directory, path }));
        const unchanged = before !== undefined && before.modifiedAt !== null && before.size === info.size && before.modifiedAt === info.mtimeMs;
        const hash = unchanged
          ? before.hash
          : await hashFile(absolute, info.size).catch((cause: unknown) => {
              if ((cause as { code?: unknown }).code === "ENOENT") return undefined;
              throw new ScanError("Could not read " + path, { cause });
            });
        if (hash === undefined) return undefined;
        const racy = info.mtimeMs > started - RACY_MS;
        return { directory, path, hash, size: info.size, modifiedAt: racy ? null : info.mtimeMs };
      });
      return versions.filter((version) => version !== undefined);
    },
    catch: (cause) =>
      cause instanceof ScanError
        ? new ProjectFilesError({ message: cause.message, cause: cause.cause })
        : new ProjectFilesError({ message: "Could not scan the working directories", cause }),
  });
