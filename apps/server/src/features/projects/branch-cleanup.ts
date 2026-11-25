import { createHmac, randomBytes } from "node:crypto";
import { Clock, Effect, Option } from "effect";
import { findProject } from "./find-project.js";
import { branchIdentity, fetchMergeTarget, inspectBranch, isAncestor, repositoryIdentity } from "./git/index.js";
import { mainDirectory } from "./project-context.js";
import { ProjectRepository } from "./repository.js";
import { WorktreeNotFound } from "./worktrees.js";

const secret = randomBytes(32);
export const confirmationFor = (state: unknown) => createHmac("sha256", secret).update(JSON.stringify(state)).digest("hex");
const blocked = (reason: string) => ({ status: "blocked" as const, reason });
const deleted = { status: "deleted" } as const;

export const recordBranchDeleted = Effect.fnUntraced(function* (ownerId: string) {
  const repository = yield* ProjectRepository;
  yield* repository.setWorktreeBranchDeleted(ownerId, yield* Clock.currentTimeMillis);
});

export const verifyRemovedBranch = Effect.fn("verifyRemovedBranch")(function* (projectId: string, threadId: string) {
  const project = yield* findProject(projectId);
  const found = yield* (yield* ProjectRepository).worktreeOfThread(threadId);
  if (Option.isNone(found) || found.value.projectId !== project.id) return yield* new WorktreeNotFound({ threadId });
  const row = found.value;
  if (row.removedAt === null) return blocked("Remove the worktree before deleting its branch.");
  if (row.branchDeletedAt !== null) return deleted;

  const directory = mainDirectory(project);
  const repository = yield* repositoryIdentity(directory);
  if (repository === null) return blocked("The project's Git repository is unavailable.");
  const ref = `refs/heads/${row.branch}`;
  const local = yield* inspectBranch(directory, ref);
  if (local.status === "missing") {
    yield* recordBranchDeleted(row.threadId);
    return deleted;
  }
  if (local.status !== "present") return blocked("The local branch could not be verified.");
  if (local.occupied) return blocked("The branch is checked out in a worktree.");
  const identity = yield* branchIdentity(repository, ref, local.tip);
  if (identity === null || identity !== row.removedBranchIdentity) {
    return blocked("The branch's identity could not be verified against the removed worktree. It may have changed or been recreated.");
  }

  const target = yield* fetchMergeTarget(directory, ref);
  if (target === null) return blocked("The remote merge target could not be verified and fetched. Check the remote and try again.");
  if (ref === target.ref) return blocked("This branch is the remote merge target.");
  if (!(yield* isAncestor(directory, local.tip, target.tip))) return blocked(`Merge not verified against ${target.label}. Squash and rebase merges may not preserve the branch's ancestry.`);

  const state = { projectId, ownerId: row.threadId, removedAt: row.removedAt, directory, repository, ref, identity, tip: local.tip, target };
  return { status: "ready" as const, branch: row.branch, state };
});
