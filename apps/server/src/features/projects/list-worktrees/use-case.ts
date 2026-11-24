import { inspectBranch } from "../branch-cleanup-git.js";
import type { ListWorktreesResponse } from "@wiki-agents/contracts/projects/list-worktrees/response";
import { Effect } from "effect";
import { findProject } from "../find-project.js";
import { changedPaths } from "../git.js";
import { mainDirectory } from "../project-context.js";
import { ProjectRepository } from "../repository.js";
import { findVault } from "../../vaults/find-vault.js";
import { worktreeAvailability, worktreeExists } from "../worktrees.js";

/**
 * The project's thread worktrees with how many files each has changed from its `HEAD`
 * (the main directory's ignored files left out), and whether new threads can have
 * one, for New thread, the overview and thread headers.
 */
export const listWorktrees = Effect.fn("listProjectWorktrees")(function* (projectId: string) {
  const project = yield* findProject(projectId);
  const repository = yield* ProjectRepository;
  const main = mainDirectory(project);
  const ignored = new Set((yield* repository.ignoredFiles(project.id)).filter((file) => file.directory === main).map((file) => file.path));
  const shares = yield* repository.worktreeShares(project.id);
  const sharedWith = (ownerThreadId: string) => shares.filter((share) => share.ownerThreadId === ownerThreadId).map((share) => share.threadId);
  const worktrees = yield* Effect.forEach(
    yield* repository.worktrees(project.id),
    (worktree) =>
      Effect.gen(function* () {
        const exists = yield* worktreeExists(worktree);
        const changedFiles = exists ? (yield* changedPaths(worktree.directory)).filter((change) => !ignored.has(change.path)).length : null;
        const branchDeleted = worktree.branchDeletedAt !== null || (worktree.removedAt !== null &&
          (yield* inspectBranch(main, `refs/heads/${worktree.branch}`)).status === "missing");
        return { ...worktree, exists, changedFiles, branchDeleted, sharedWith: sharedWith(worktree.threadId) };
      }),
    { concurrency: 4 },
  );
  const availability = yield* worktreeAvailability(project, (yield* findVault(project.vaultId)).rootPath);
  return { available: availability.available, unavailableReason: availability.available ? null : availability.reason, worktrees } satisfies ListWorktreesResponse;
});
