import type { GetGitStatusResponse } from "@wiki-agents/contracts/projects/get-git-status/response";
import { Effect } from "effect";
import { gitDirectories } from "../git-directories.js";
import { gitStatus } from "../git-status.js";

/** Each git directory's branch, upstream and ahead/behind, for the Diff view's headers. Never fetches. */
export const getGitStatus = Effect.fn("getProjectGitStatus")(function* (projectId: string) {
  const directories = yield* Effect.forEach(yield* gitDirectories(projectId), gitStatus, { concurrency: 4 });
  return { directories } satisfies GetGitStatusResponse;
});
