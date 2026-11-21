import type { CheckWorktreeBranchResponse } from "@wiki-agents/contracts/projects/check-worktree-branch/response";
import { Effect } from "effect";
import { confirmationFor, verifyRemovedBranch } from "../branch-cleanup.js";

export const checkWorktreeBranch = Effect.fn("checkWorktreeBranch")(function* (projectId: string, threadId: string) {
  const result = yield* verifyRemovedBranch(projectId, threadId);
  return (result.status === "ready"
    ? { status: "ready", branch: result.branch, target: result.state.target.label, confirmation: confirmationFor(result.state) }
    : result) satisfies CheckWorktreeBranchResponse;
});
