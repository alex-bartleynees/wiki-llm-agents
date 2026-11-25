import type { CommitChangesRequest } from "@wiki-agents/contracts/projects/commit-changes/request";
import type { CommitChangesResponse } from "@wiki-agents/contracts/projects/commit-changes/response";
import { Effect } from "effect";
import { contentHashes } from "../content-hashes.js";
import { InvalidProject, StaleReview } from "../errors.js";
import { IGNORED } from "../files.js";
import { gitDirectory } from "../git-directories.js";
import { gitStatus } from "../git-status.js";
import { changedPaths, commitExactly, headCommit } from "../git/index.js";
import { isInsidePath } from "../paths.js";

/** At most this many paths are named in a refusal. */
const NAMED = 5;
const named = (paths: ReadonlyArray<string>) => paths.slice(0, NAMED).join(", ") + (paths.length > NAMED ? ` and ${paths.length - NAMED} more` : "");

/**
 * Commits exactly the ticked files, as you reviewed them. Checked first: `HEAD` is the
 * commit you reviewed against, each file still differs from it and holds what you
 * saw (its hash); otherwise nothing is done. Then new files are added and
 * `git commit --only` takes those paths and nothing else in the index, so a file you
 * didn't tick (an ignored one, say) stays out even when it is staged. Hooks run; when
 * one fails, the files it added are taken back out of the index and git's message
 * comes back.
 */
export const commitChanges = Effect.fn("commitProjectChanges")(function* (projectId: string, request: CommitChangesRequest) {
  const entry = yield* gitDirectory(projectId, request.directory);
  const directory = entry.directory;
  const message = request.message.trim();
  if (message === "") return yield* new InvalidProject({ message: "Write a commit message" });
  const paths = request.files.map((file) => file.path);
  if (paths.length === 0) return yield* new InvalidProject({ message: "Tick at least one file to commit" });
  if (!paths.every(isInsidePath)) return yield* new InvalidProject({ message: "Paths must be relative and inside the working directory" });
  if (new Set(paths).size !== paths.length) return yield* new InvalidProject({ message: "A file is listed twice" });

  const head = yield* headCommit(directory);
  if (head !== request.head) return yield* new StaleReview({ message: "A commit was made here since you reviewed the changes. Review them again." });
  const changed = new Set((yield* changedPaths(directory, IGNORED)).map((change) => change.path));
  const unchanged = paths.filter((path) => !changed.has(path));
  if (unchanged.length > 0) return yield* new StaleReview({ message: `No longer changed: ${named(unchanged)}. Review the changes again.` });
  const hashes = yield* contentHashes(directory, paths);
  const moved = request.files.filter((file) => hashes.get(file.path) !== file.hash).map((file) => file.path);
  if (moved.length > 0) return yield* new StaleReview({ message: `Changed since you reviewed them: ${named(moved)}. Review the changes again.` });

  const made = yield* commitExactly(directory, head, paths, message, IGNORED);
  return { ...made, status: yield* gitStatus(entry) } satisfies CommitChangesResponse;
});
