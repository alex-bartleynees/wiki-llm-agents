import { join } from "node:path";
import type { DiffFile, FileChange } from "@wiki-agents/contracts/projects/model";
import { ByteSize, Effect, FileSystem } from "effect";
import { GitFailed } from "./errors.js";
import { type DiffLimits, type NameStatus, parseNameStatus, sectionToFile, splitPatch, untrackedFile, withoutDiff } from "./patch.js";
import { output, runGit as run } from "./process.js";

/** Untracked files larger than this are listed without reading them. */
const MAX_UNTRACKED_BYTES = 32n * 1024n * 1024n;
const CONCURRENCY = 16;

/** What the working tree is compared with: `HEAD`, or the empty tree before the first commit. */
const base = Effect.fnUntraced(function* (directory: string, knownHead?: string | null) {
  if (knownHead !== undefined) {
    return knownHead !== null ? "HEAD" : (yield* output(directory, ["hash-object", "-t", "tree", "/dev/null"])).trim();
  }
  return (yield* run(directory, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).code === 0
    ? "HEAD"
    : (yield* output(directory, ["hash-object", "-t", "tree", "/dev/null"])).trim();
});

/** `git diff <base>`: staged and unstaged changes together, renames detected, paths relative to `directory`. */
const diffArgs = (from: string) => ["diff", from, "-M", "--relative", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

/** Untracked, not ignored files below `directory` (nested repositories and generated trees left out). */
const untrackedPaths = (directory: string, skip: ReadonlySet<string>, paths: ReadonlyArray<string> = []) =>
  Effect.map(output(directory, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...paths], true), (listed) =>
    listed.split("\0").filter((path) => path !== "" && !path.endsWith("/") && !path.split("/").some((part) => skip.has(part))),
  );

const readUntracked = Effect.fnUntraced(function* (directory: string, path: string, limits: DiffLimits) {
  const fs = yield* FileSystem.FileSystem;
  const absolute = join(directory, path);
  const info = yield* fs.lstat(absolute).pipe(Effect.orElseSucceed(() => undefined));
  if (info === undefined) return undefined;
  if (info.type === "SymbolicLink") return untrackedFile(path, new TextEncoder().encode(yield* fs.readLink(absolute).pipe(Effect.mapError(failed))), limits);
  if (info.type !== "File") return undefined;
  if (ByteSize.toBigInt(info.size) > MAX_UNTRACKED_BYTES) {
    return { path, oldPath: null, status: "untracked", binary: false, additions: 0, deletions: 0, diff: "", truncated: true } satisfies DiffFile;
  }
  const content = yield* fs.readFile(absolute).pipe(Effect.orElseSucceed(() => undefined));
  return content === undefined ? undefined : untrackedFile(path, content, limits);
});

/** The tracked files' diffs, for entries git already listed. */
const trackedFiles = Effect.fnUntraced(function* (directory: string, from: string, entries: ReadonlyArray<NameStatus>, limits: DiffLimits) {
  if (entries.length === 0) return [];
  const sections = splitPatch(yield* output(directory, diffArgs(from), true));
  if (sections.length === entries.length) return entries.map((entry, index) => sectionToFile(entry, sections[index]!, limits));
  // The tree changed between the two reads (an agent is writing): ask for each file on its own.
  return yield* Effect.forEach(entries, (entry) => oneTracked(directory, from, entry, limits), { concurrency: CONCURRENCY });
});

const oneTracked = Effect.fnUntraced(function* (directory: string, from: string, entry: NameStatus, limits: DiffLimits) {
  const paths = entry.oldPath === null ? [entry.path] : [entry.oldPath, entry.path];
  const section = splitPatch(yield* output(directory, [...diffArgs(from), "--", ...paths], true))[0];
  const file: DiffFile = section === undefined ? { ...entry, binary: false, additions: 0, deletions: 0, diff: "", truncated: false } : sectionToFile(entry, section, limits);
  return file;
});

const changedEntries = (directory: string, from: string) =>
  Effect.map(output(directory, [...diffArgs(from), "--name-status", "-z"], true), parseNameStatus);

const failed = (cause: unknown) => new GitFailed({ message: "Could not read the changes from git", cause });

/**
 * Every file in `directory` that differs from `HEAD`, sorted by path: tracked changes
 * (staged and unstaged) and untracked files as new. Each diff is cut to `limits`;
 * once the diffs reach `budget` characters, later files come without theirs.
 */
export const diffDirectory = (directory: string, limits: DiffLimits, budget: number, skip: ReadonlySet<string>, knownHead?: string | null) =>
  Effect.gen(function* () {
    const from = yield* base(directory, knownHead);
    const [tracked, untracked] = yield* Effect.all(
      [
        changedEntries(directory, from).pipe(Effect.flatMap((entries) => trackedFiles(directory, from, entries, limits))),
        untrackedPaths(directory, skip).pipe(
          Effect.flatMap((paths) => Effect.forEach(paths, (path) => readUntracked(directory, path, limits), { concurrency: CONCURRENCY })),
        ),
      ],
      { concurrency: 2 },
    );
    const files = [...tracked, ...untracked.filter((file) => file !== undefined)].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let used = 0;
    return files.map((file) => {
      if (used >= budget) return withoutDiff(file);
      used += file.diff.length;
      return file;
    });
  });

/**
 * The paths in `directory` that differ from `HEAD`, as the diff lists them, without
 * reading any diffs: new (added or untracked), modified, deleted. A rename is its old
 * path deleted and its new path created. Sorted by path.
 */
export const changedPaths = (directory: string, skip: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const from = yield* base(directory);
    const [entries, untracked] = yield* Effect.all([changedEntries(directory, from), untrackedPaths(directory, skip)], { concurrency: 2 });
    const changes: Array<FileChange> = untracked.map((path) => ({ directory, path, status: "created" }));
    for (const entry of entries) {
      if (entry.oldPath !== null) changes.push({ directory, path: entry.oldPath, status: "deleted" });
      const status = entry.status === "modified" ? "modified" : entry.status === "deleted" ? "deleted" : "created";
      changes.push({ directory, path: entry.path, status });
    }
    return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  });

/** One file's diff from `HEAD` (tracked or untracked); undefined when it hasn't changed. */
export const diffFile = (directory: string, path: string, limits: DiffLimits, skip: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const from = yield* base(directory);
    const entry = (yield* changedEntries(directory, from)).find((candidate) => candidate.path === path);
    if (entry !== undefined) return yield* oneTracked(directory, from, entry, limits);
    if ((yield* untrackedPaths(directory, skip, [path])).includes(path)) return yield* readUntracked(directory, path, limits);
    return undefined;
  });

/** Which of `paths` are untracked (and not ignored) in `directory`. */
export const untrackedAmong = (directory: string, paths: ReadonlyArray<string>, skip: ReadonlySet<string>) =>
  Effect.gen(function* () {
    if (paths.length === 0) return [];
    const untracked = new Set(yield* untrackedPaths(directory, skip, paths));
    return paths.filter((path) => untracked.has(path));
  });
