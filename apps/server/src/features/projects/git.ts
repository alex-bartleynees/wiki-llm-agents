import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { DiffFile, FileChange } from "@wiki-agents/contracts/projects/model";
import { Effect } from "effect";
import { IGNORED, ProjectFilesError } from "./files.js";
import {
  type DiffLimits,
  LIST_BUDGET_CHARS,
  type NameStatus,
  parseNameStatus,
  sectionToFile,
  splitPatch,
  untrackedFile,
  withoutDiff,
} from "./git-diff.js";

/**
 * Reads a project's changes from git. Read-only: it never commits, stages, checks out
 * or restores. git runs with `execFile` (no shell) in one working directory at a time
 * (`-C`), without a pager, colour, external diff tools or textconv, and with literal
 * pathspecs, so a file name is never a glob or an option.
 */

class GitFailed extends Error {}

/** Untracked files larger than this are listed without reading them. */
const MAX_UNTRACKED_BYTES = 32 * 1024 * 1024;

const run = (directory: string, args: ReadonlyArray<string>, literal = false) =>
  new Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>((resolve) =>
    execFile(
      "git",
      ["--no-pager", ...(literal ? ["--literal-pathspecs"] : []), "-C", directory, ...args],
      // No index refresh on the way: reading must not take git's lock while an agent or lazygit works.
      { maxBuffer: 1024 * 1024 * 1024, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } },
      (error, stdout, stderr) => resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr }),
    ),
  );

/** Runs git and fails when it does. */
const output = async (directory: string, args: ReadonlyArray<string>, literal = false) => {
  const result = await run(directory, args, literal);
  if (result.code !== 0) throw new GitFailed(`git ${args[0]} failed in ${directory}: ${result.stderr.trim() || `exit ${result.code}`}`);
  return result.stdout;
};

/**
 * Whether `directory` is in a git work tree, and not ignored by it (git would list
 * nothing there, so the diff would look clean).
 */
const isWorkTree = async (directory: string) => (await run(directory, ["check-ignore", "-q", "."])).code === 1;

/** What the working tree is compared with: `HEAD`, or the empty tree before the first commit. */
const base = async (directory: string) =>
  (await run(directory, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).code === 0
    ? "HEAD"
    : (await output(directory, ["hash-object", "-t", "tree", "/dev/null"])).trim();

/** `git diff <base>`: staged and unstaged changes together, renames detected, paths relative to `directory`. */
const diffArgs = (from: string) => ["diff", from, "-M", "--relative", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

/** Untracked, not ignored files below `directory` (nested repositories and generated trees left out). */
const untrackedPaths = async (directory: string, paths: ReadonlyArray<string> = []) =>
  (await output(directory, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...paths], true))
    .split("\0")
    .filter((path) => path !== "" && !path.endsWith("/") && !path.split("/").some((part) => IGNORED.has(part)));

const readUntracked = async (directory: string, path: string, limits: DiffLimits): Promise<DiffFile | undefined> => {
  const absolute = join(directory, path);
  const info = await lstat(absolute).catch(() => undefined);
  if (info === undefined) return undefined;
  if (info.isSymbolicLink()) return untrackedFile(path, new TextEncoder().encode(await readlink(absolute)), limits);
  if (!info.isFile()) return undefined;
  if (info.size > MAX_UNTRACKED_BYTES) return { path, oldPath: null, status: "untracked", binary: false, additions: 0, deletions: 0, diff: "", truncated: true };
  const content = await readFile(absolute).catch(() => undefined);
  return content === undefined ? undefined : untrackedFile(path, content, limits);
};

/** The tracked files' diffs, for entries git already listed. */
const trackedFiles = async (directory: string, from: string, entries: ReadonlyArray<NameStatus>, limits: DiffLimits) => {
  if (entries.length === 0) return [];
  const sections = splitPatch(await output(directory, diffArgs(from), true));
  if (sections.length === entries.length) return entries.map((entry, index) => sectionToFile(entry, sections[index]!, limits));
  // The tree changed between the two reads (an agent is writing): ask for each file on its own.
  return Promise.all(entries.map((entry) => oneTracked(directory, from, entry, limits)));
};

const oneTracked = async (directory: string, from: string, entry: NameStatus, limits: DiffLimits): Promise<DiffFile> => {
  const paths = entry.oldPath === null ? [entry.path] : [entry.oldPath, entry.path];
  const section = splitPatch(await output(directory, [...diffArgs(from), "--", ...paths], true))[0];
  return section === undefined ? { ...entry, binary: false, additions: 0, deletions: 0, diff: "", truncated: false } : sectionToFile(entry, section, limits);
};

const changedEntries = async (directory: string, from: string) => parseNameStatus(await output(directory, [...diffArgs(from), "--name-status", "-z"], true));

const failed = (cause: unknown) =>
  cause instanceof GitFailed
    ? new ProjectFilesError({ message: cause.message, cause })
    : new ProjectFilesError({ message: "Could not read the changes from git", cause });

/** Whether each directory is in a git work tree, in order. */
export const workTrees = (directories: ReadonlyArray<string>) =>
  Effect.tryPromise({ try: () => Promise.all(directories.map(isWorkTree)), catch: failed });

/**
 * Every file in `directory` that differs from `HEAD`, sorted by path: tracked changes
 * (staged and unstaged) and untracked files as new. Each diff is cut to `limits`;
 * once the diffs reach `budget` characters, later files come without theirs.
 */
export const diffDirectory = (directory: string, limits: DiffLimits, budget = LIST_BUDGET_CHARS) =>
  Effect.tryPromise({
    try: async () => {
      const from = await base(directory);
      const [tracked, untracked] = await Promise.all([
        changedEntries(directory, from).then((entries) => trackedFiles(directory, from, entries, limits)),
        untrackedPaths(directory).then((paths) => Promise.all(paths.map((path) => readUntracked(directory, path, limits)))),
      ]);
      const files = [...tracked, ...untracked.filter((file) => file !== undefined)].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      let used = 0;
      return files.map((file) => {
        if (used >= budget) return withoutDiff(file);
        used += file.diff.length;
        return file;
      });
    },
    catch: failed,
  });

/**
 * The paths in `directory` that differ from `HEAD`, as the diff lists them, without
 * reading any diffs: new (added or untracked), modified, deleted. A rename is its old
 * path deleted and its new path created. Sorted by path.
 */
export const changedPaths = (directory: string) =>
  Effect.tryPromise({
    try: async (): Promise<Array<FileChange>> => {
      const from = await base(directory);
      const [entries, untracked] = await Promise.all([changedEntries(directory, from), untrackedPaths(directory)]);
      const changes: Array<FileChange> = untracked.map((path) => ({ directory, path, status: "created" }));
      for (const entry of entries) {
        if (entry.oldPath !== null) changes.push({ directory, path: entry.oldPath, status: "deleted" });
        const status = entry.status === "modified" ? "modified" : entry.status === "deleted" ? "deleted" : "created";
        changes.push({ directory, path: entry.path, status });
      }
      return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    catch: failed,
  });

/** One file's diff from `HEAD` (tracked or untracked); undefined when it hasn't changed. */
export const diffFile = (directory: string, path: string, limits: DiffLimits) =>
  Effect.tryPromise({
    try: async (): Promise<DiffFile | undefined> => {
      const from = await base(directory);
      const entry = (await changedEntries(directory, from)).find((candidate) => candidate.path === path);
      if (entry !== undefined) return oneTracked(directory, from, entry, limits);
      if ((await untrackedPaths(directory, [path])).includes(path)) return readUntracked(directory, path, limits);
      return undefined;
    },
    catch: failed,
  });
