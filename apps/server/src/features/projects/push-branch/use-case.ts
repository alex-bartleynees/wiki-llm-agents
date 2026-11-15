import type { PushBranchRequest } from "@wiki-agents/contracts/projects/push-branch/request";
import type { PushBranchResponse } from "@wiki-agents/contracts/projects/push-branch/response";
import { Effect } from "effect";
import { pushBranch as push } from "../commit-git.js";
import { InvalidProject, StaleReview } from "../errors.js";
import { gitDirectory } from "../git-directories.js";
import { gitStatus } from "../git-status.js";
import { branchStatus } from "../git.js";

/**
 * Pushes the checked-out branch to its upstream, or, for a branch without one and
 * only when you agreed (`setUpstream`), to the same name on that remote, setting it
 * as the upstream. Never forced and never another branch; a rejected push comes back
 * with git's message (sort it out in lazygit).
 */
export const pushBranch = Effect.fn("pushProjectBranch")(function* (projectId: string, request: PushBranchRequest) {
  const entry = yield* gitDirectory(projectId, request.directory);
  const status = yield* branchStatus(entry.directory);
  if (status.branch === null) return yield* new InvalidProject({ message: "No branch is checked out (detached HEAD), so there is nothing to push" });
  if (status.branch !== request.branch) return yield* new StaleReview({ message: `${status.branch} is checked out now, not ${request.branch}. Refresh and try again.` });
  let output: string;
  if (status.upstream !== null) {
    output = yield* push(entry.directory, status.upstream.remote, status.branch, status.upstream.branch, false);
  } else if (request.setUpstream === undefined) {
    return yield* new StaleReview({ message: `${status.branch} has no upstream yet. Confirm the remote to push it to.` });
  } else if (!status.remotes.includes(request.setUpstream.remote)) {
    return yield* new InvalidProject({ message: `There is no remote called ${request.setUpstream.remote}` });
  } else {
    output = yield* push(entry.directory, request.setUpstream.remote, status.branch, status.branch, true);
  }
  return { output, status: yield* gitStatus(entry) } satisfies PushBranchResponse;
});
