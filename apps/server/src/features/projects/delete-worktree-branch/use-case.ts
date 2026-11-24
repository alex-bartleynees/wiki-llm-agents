import { Data, Effect } from "effect";
import { deleteVerifiedRef, inspectBranch } from "../branch-cleanup-git.js";
import { confirmationFor, recordBranchDeleted, verifyRemovedBranch } from "../branch-cleanup.js";

export class BranchCleanupRefused extends Data.TaggedError("BranchCleanupRefused")<{ readonly message: string }> {}

export const deleteWorktreeBranch = Effect.fn("deleteWorktreeBranch")(function* (projectId: string, threadId: string, confirmation: string) {
  const result = yield* verifyRemovedBranch(projectId, threadId);
  if (result.status === "deleted") return result;
  if (result.status === "blocked") return yield* new BranchCleanupRefused({ message: result.reason });
  const state = result.state;
  if (confirmation !== confirmationFor(state)) {
    return yield* new BranchCleanupRefused({ message: "The branch or merge target changed. Check again and confirm the new result." });
  }
  // Finish reconciliation even if the request closes after Git starts the mutation.
  return yield* Effect.uninterruptible(Effect.gen(function* () {
    const removed = yield* deleteVerifiedRef(state.directory, state.repository, state.ref, state.tip, state.identity, state.target.tracking, state.target.tip);
    if (!removed) {
      const local = yield* inspectBranch(state.directory, state.ref, state.repository);
      if (local.status !== "missing") {
        return yield* new BranchCleanupRefused({
          message: local.status === "present" && local.occupied
            ? "The branch is checked out in a worktree."
            : "Git could not delete the verified branch. Check again before retrying.",
        });
      }
    }
    yield* recordBranchDeleted(state.ownerId);
    return { status: "deleted" } as const;
  }));
});
