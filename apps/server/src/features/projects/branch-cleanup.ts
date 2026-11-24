import { createHmac, randomBytes } from "node:crypto";
import { Clock, Effect, Option } from "effect";
import { branchIdentity, digest, inspectBranch, repositoryIdentity } from "./branch-cleanup-git.js";
import { queryRemoteForCleanup } from "./commit-git.js";
import { findProject } from "./find-project.js";
import { mainDirectory } from "./project-context.js";
import { ProjectRepository } from "./repository.js";
import { runGit } from "./run-git.js";
import { WorktreeNotFound } from "./worktrees.js";

const secret = randomBytes(32);
export const confirmationFor = (state: unknown) => createHmac("sha256", secret).update(digest(state)).digest("hex");
const blocked = (reason: string) => ({ status: "blocked" as const, reason });
const deleted = { status: "deleted" } as const;

export const recordBranchDeleted = Effect.fnUntraced(function* (ownerId: string) {
  const repository = yield* ProjectRepository;
  yield* repository.setWorktreeBranchDeleted(ownerId, yield* Clock.currentTimeMillis);
});

const remoteTarget = Effect.fnUntraced(function* (directory: string) {
  const remotes = yield* runGit(directory, ["remote"]);
  if (remotes.code !== 0) return null;
  const names = remotes.stdout.trim().split("\n").filter(Boolean);
  const remote = names.includes("origin") ? "origin" : names.length === 1 ? names[0]! : null;
  if (remote === null || remote.startsWith("-")) return null;
  const url = yield* runGit(directory, ["remote", "get-url", "--", remote]);
  if (url.code !== 0) return null;
  const remoteUrl = url.stdout.trim();
  const advertised = yield* queryRemoteForCleanup(directory, ["ls-remote", "--symref", "--exit-code", "--", remote, "HEAD"]);
  const rows = advertised.split("\n");
  const ref = rows.find((row) => row.startsWith("ref: refs/heads/") && row.endsWith("\tHEAD"))?.slice(5, -5);
  const tip = rows.find((row) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})\t/.test(row) && row.endsWith("\tHEAD"))?.split("\t")[0];
  if (ref === undefined || tip === undefined || (yield* runGit(directory, ["check-ref-format", ref])).code !== 0) return null;
  const branch = ref.slice("refs/heads/".length);
  const tracking = `refs/remotes/${remote}/${branch}`;
  if ((yield* runGit(directory, ["check-ref-format", tracking])).code !== 0) return null;
  return { remote, remoteUrl, ref, tracking, tip, label: `${remote}/${branch}` };
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

  const target = yield* Effect.gen(function* () {
    const target = yield* remoteTarget(directory);
    if (target === null || ref === target.ref) return target;
    yield* queryRemoteForCleanup(directory, [
      "fetch", "--no-tags", "--no-prune", "--no-prune-tags", "--no-auto-maintenance", "--no-recurse-submodules", "--no-write-fetch-head",
      "--refmap=", "--", target.remote, `+${target.ref}:${target.tracking}`,
    ]);
    const fetched = yield* inspectBranch(directory, target.tracking);
    return fetched.status === "present" && fetched.tip === target.tip ? target : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));
  if (target === null) return blocked("The remote merge target could not be verified and fetched. Check the remote and try again.");
  if (ref === target.ref) return blocked("This branch is the remote merge target.");
  const ancestry = yield* runGit(
    directory, ["--no-replace-objects", "merge-base", "--is-ancestor", local.tip, target.tip], false, { GIT_GRAFT_FILE: "/dev/null" },
  );
  if (ancestry.code !== 0) return blocked(`Merge not verified against ${target.label}. Squash and rebase merges may not preserve the branch's ancestry.`);

  const state = { projectId, ownerId: row.threadId, removedAt: row.removedAt, directory, repository, ref, identity, tip: local.tip, target };
  return { status: "ready" as const, branch: row.branch, state };
});
