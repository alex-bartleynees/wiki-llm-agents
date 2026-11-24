import { dirname, join, relative } from "node:path";
import { Data, Effect, FileSystem } from "effect";
import { removeEmptyDirectory } from "../../shared/node-files.js";
import { ProjectFilesError } from "./files.js";
import { isWorkTree, runGit } from "./run-git.js";

/**
 * The worktree Git writes, each started by the user: `git worktree add` (a new
 * branch from `HEAD`) and `git worktree remove` without `--force`. Neither touches the
 * main working tree, the index or any branch but the new one. Everything else in
 * `git.ts` only reads.
 */

/** git said no; `message` is git's own, for the user. */
export class WorktreeRefused extends Data.TaggedError("WorktreeRefused")<{ readonly message: string }> {}

const gitMessage = (stderr: string, fallback: string) => stderr.trim().replace(/^(fatal|error): /gm, "") || fallback;

/**
 * Whether `directory` can give a thread a worktree: in a git work tree (not ignored),
 * where it sits in its repository (`apps/web/`, or "" at the top), and whether `HEAD`
 * has it (false before the first commit, or for a folder not committed yet), since a
 * worktree from `HEAD` would otherwise lack it.
 */
export const worktreeSource = (directory: string) =>
  Effect.gen(function* () {
    if (!(yield* isWorkTree(directory))) return { git: false as const };
    const prefix = yield* runGit(directory, ["rev-parse", "--show-prefix"]);
    if (prefix.code !== 0) return { git: false as const };
    const folder = prefix.stdout.trim().replace(/\/+$/, "");
    const inHead = (yield* runGit(directory, ["rev-parse", "--verify", "--quiet", `HEAD:${folder}`])).code === 0;
    return { git: true as const, prefix: folder, inHead };
  });

/** A branch name git accepts for a new branch (`check-ref-format --branch`), never one that reads as an option. */
export const checkBranch = (directory: string, branch: string) =>
  Effect.gen(function* () {
    const refused = new WorktreeRefused({ message: `"${branch}" isn't a valid branch name` });
    if (branch === "" || branch.startsWith("-") || branch.trim() !== branch) return yield* refused;
    const result = yield* runGit(directory, ["check-ref-format", "--branch", branch]);
    if (result.code !== 0 || result.stdout.trim() !== branch) return yield* refused;
  });

/**
 * `git worktree add -b <branch> <path> HEAD` in `directory`, making the parent folders
 * first. Returns the worktree's canonical root.
 */
export const addWorktree = (directory: string, branch: string, path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => new ProjectFilesError({ message: `Could not make the worktree folder ${dirname(path)}`, cause })),
    );
    const result = yield* Effect.uninterruptible(runGit(directory, ["worktree", "add", "--quiet", "-b", branch, path, "HEAD"]));
    if (result.code !== 0) return yield* new WorktreeRefused({ message: gitMessage(result.stderr, `git worktree add failed (exit ${result.code})`) });
    return yield* fs.realPath(path).pipe(
      Effect.mapError((cause) => new ProjectFilesError({ message: `git made the worktree, but ${path} can't be read`, cause })),
    );
  });

/** `git worktree remove <path>` in `directory`, without `--force`: git refuses while it has changes. */
export const removeWorktree = (directory: string, path: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.uninterruptible(runGit(directory, ["worktree", "remove", path]));
    if (result.code !== 0) {
      // git suggests --force, which the app never uses: say what to do instead.
      const message = gitMessage(result.stderr, `git worktree remove failed (exit ${result.code})`);
      const forced = /,? use --force to delete it\.?$/m;
      return yield* new WorktreeRefused({
        message: forced.test(message) ? `${message.replace(forced, ".")} Commit the changes in the project’s Diff view or discard them with your Git client before removing the worktree.` : message,
      });
    }
  });

/** Removes the folders a branch name like `wiki-agents/abc` left behind, while empty, up to `root`. */
export const removeEmptyParents = (path: string, root: string) =>
  Effect.gen(function* () {
    for (let folder = dirname(path); relative(root, folder) !== "" && !relative(root, folder).startsWith(".."); folder = dirname(folder)) {
      if (!(yield* removeEmptyDirectory(folder).pipe(Effect.as(true), Effect.orElseSucceed(() => false)))) return;
    }
  });

/** Where a thread's worktree goes: `<root>/<project id>/<branch>`. */
export const worktreePath = (root: string, projectId: string, branch: string) => join(root, projectId, branch);
