import { stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { Project, Worktree } from "@wiki-agents/contracts/projects/model";
import { Clock, Context, Data, Effect, Layer, Option } from "effect";
import { AppConfig } from "../../shared/config.js";
import { captureRemovedBranch } from "./branch-cleanup-git.js";
import { InvalidProject } from "./errors.js";
import { findProject } from "./find-project.js";
import { mainDirectory } from "./project-context.js";
import { ProjectRepository } from "./repository.js";
import { addWorktree, checkBranch, removeEmptyParents, removeWorktree, worktreePath, worktreeSource } from "./worktree-git.js";

/**
 * Opt-in git worktrees for threads (slice 14b): a thread can run in its own checkout of
 * the project's main directory, on a new branch, so two threads in one repository never
 * mix their changes. The app makes and removes them when asked. Branch cleanup is a separate action.
 */

/**
 * The folder worktrees go in: `<data dir>/worktrees`. Not the config directory (which
 * Syncthing may carry) and not a cache (which may be cleared with work in it).
 */
export class WorktreeRoot extends Context.Service<WorktreeRoot, { readonly directory: string }>()("WorktreeRoot") {}

export const makeWorktreeRoot = (directory: string) => Layer.succeed(WorktreeRoot, WorktreeRoot.of({ directory }));

export const WorktreeRootLive = Layer.unwrap(
  Effect.map(AppConfig.dataDir.pipe(Effect.orDie), (dataDir) => makeWorktreeRoot(join(dataDir, "worktrees"))),
);

export class WorktreeNotFound extends Data.TaggedError("WorktreeNotFound")<{ readonly threadId: string }> {}

const exists = (path: string) => Effect.promise(() => stat(path).then((info) => info.isDirectory(), () => false));

const isWithin = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Whether the project's threads can have worktrees: not for a main directory in the
 * shared vault (a vault-only project), outside git, or missing from `HEAD`. Gives
 * where the main directory sits in its repository, or why not.
 */
export const worktreeAvailability = Effect.fnUntraced(function* (project: Project, vaultRoot: string) {
  const main = mainDirectory(project);
  if (isWithin(vaultRoot, main)) return { available: false as const, reason: "Worktrees are for projects with their own repository, not folders in the shared vault" };
  const source = yield* worktreeSource(main);
  if (!source.git) return { available: false as const, reason: "The project's main directory isn't in a git repository, so it can't have worktrees" };
  if (!source.inHead) {
    return { available: false as const, reason: "The project's main directory isn't in the repository's last commit, so a new worktree wouldn't have it" };
  }
  return { available: true as const, prefix: source.prefix };
});

/**
 * Makes the thread's worktree from the main directory's `HEAD` and records it. Refused
 * when the project can't have worktrees (`worktreeAvailability`), and when git
 * refuses (the branch exists, say), with git's message.
 */
export const createWorktree = Effect.fn("createWorktree")(function* (project: Project, vaultRoot: string, threadId: string, branch: string) {
  const main = mainDirectory(project);
  const availability = yield* worktreeAvailability(project, vaultRoot);
  if (!availability.available) return yield* new InvalidProject({ message: availability.reason });
  yield* checkBranch(main, branch);
  const path = yield* addWorktree(main, branch, worktreePath((yield* WorktreeRoot).directory, project.id, branch));
  const prefix = availability.prefix;
  const worktree: Worktree = {
    threadId,
    projectId: project.id,
    branch,
    path,
    directory: prefix === "" ? path : join(path, prefix),
    createdAt: yield* Clock.currentTimeMillis,
    removedAt: null,
  };
  yield* (yield* ProjectRepository).insertWorktree(worktree);
  return worktree;
});

/**
 * Undoes `createWorktree` when its thread couldn't be saved: removes the clean
 * worktree and forgets it. The branch stays.
 */
export const discardWorktree = (worktree: Worktree) =>
  Effect.gen(function* () {
    const project = yield* findProject(worktree.projectId);
    yield* removeWorktree(mainDirectory(project), worktree.path);
    yield* removeEmptyParents(worktree.path, (yield* WorktreeRoot).directory);
    yield* (yield* ProjectRepository).deleteWorktree(worktree.threadId);
  }).pipe(Effect.catch((error) => Effect.logError(`couldn't undo the worktree of thread ${worktree.threadId} at ${worktree.path}`, error)));

/**
 * Has `threadId` work in `worktree` too (a continued thread that kept the same folder):
 * both threads then work in the same files. Undone with `unshareWorktree` when the
 * thread couldn't be saved.
 */
export const shareWorktree = Effect.fnUntraced(function* (threadId: string, worktree: Worktree) {
  yield* (yield* ProjectRepository).shareWorktree(threadId, worktree.threadId);
});

export const unshareWorktree = (threadId: string) =>
  Effect.gen(function* () {
    yield* (yield* ProjectRepository).unshareWorktree(threadId);
  }).pipe(Effect.catch((error) => Effect.logError(`couldn't undo thread ${threadId}'s share of a worktree`, error)));

/**
 * Every thread working in the thread's worktree: its owner first, then the threads
 * sharing it. Just the thread itself when it has no worktree.
 */
export const threadsInWorktree = Effect.fnUntraced(function* (threadId: string) {
  const repository = yield* ProjectRepository;
  const found = yield* repository.worktreeOfThread(threadId);
  if (Option.isNone(found)) return [threadId];
  const owner = found.value.threadId;
  const shares = yield* repository.worktreeShares(found.value.projectId);
  return [owner, ...shares.filter((share) => share.ownerThreadId === owner).map((share) => share.threadId)];
});

/** The thread's worktree (its own, or the one it shares), removed or not; none for a thread made without one. */
export const threadWorktree = Effect.fnUntraced(function* (threadId: string) {
  return yield* (yield* ProjectRepository).worktreeOfThread(threadId);
});

/** Whether the worktree is there to work in: not removed, and its folder not deleted outside the app. */
export const worktreeExists = (worktree: Worktree) => (worktree.removedAt === null ? exists(worktree.directory) : Effect.succeed(false));

/** Why a thread can't run in its worktree now, or null when it can. */
export const worktreeProblem = Effect.fnUntraced(function* (threadId: string) {
  const found = yield* threadWorktree(threadId);
  if (Option.isNone(found)) return null;
  const worktree = found.value;
  if (worktree.removedAt !== null) return `This thread's worktree (branch ${worktree.branch}) was removed, so it has nowhere to work. Start a new thread to carry on.`;
  if (!(yield* exists(worktree.directory))) {
    return `This thread's worktree (branch ${worktree.branch}) is missing from ${worktree.path}; it was deleted outside the app. Start a new thread to carry on.`;
  }
  return null;
});

/**
 * `git worktree remove` without `--force`, so git refuses while there are uncommitted
 * or untracked files; its message comes back as `WorktreeRefused`. The branch is
 * kept. A worktree whose folder is already gone is only marked removed.
 */
export const removeThreadWorktree = Effect.fn("removeThreadWorktree")(function* (threadId: string) {
  const repository = yield* ProjectRepository;
  const found = yield* repository.worktreeOfThread(threadId);
  if (Option.isNone(found)) return yield* new WorktreeNotFound({ threadId });
  const worktree = found.value;
  if (worktree.removedAt !== null) return worktree;
  let identity: string | null = null;
  if (yield* exists(worktree.path)) {
    const project = yield* findProject(worktree.projectId);
    const main = mainDirectory(project);
    identity = yield* Effect.promise(() => captureRemovedBranch(main, worktree.path, worktree.branch));
    yield* removeWorktree(main, worktree.path);
    yield* removeEmptyParents(worktree.path, (yield* WorktreeRoot).directory);
  }
  const removedAt = yield* Clock.currentTimeMillis;
  // A shared worktree is its owner's record, so it is removed for every thread in it.
  yield* repository.setWorktreeRemoved(worktree.threadId, removedAt, identity);
  return { ...worktree, removedAt } satisfies Worktree;
});

/** The project's worktrees that are there to work in (and review), oldest first. */
export const liveWorktrees = Effect.fnUntraced(function* (projectId: string) {
  const all = yield* (yield* ProjectRepository).worktrees(projectId);
  return yield* Effect.filter(all, worktreeExists, { concurrency: 4 });
});
