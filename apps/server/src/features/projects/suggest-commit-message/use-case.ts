import type { SuggestCommitMessageRequest } from "@wiki-agents/contracts/projects/suggest-commit-message/request";
import type { SuggestCommitMessageResponse } from "@wiki-agents/contracts/projects/suggest-commit-message/response";
import { Effect } from "effect";
import { complete } from "../../providers/complete.js";
import { commitMessageProvider } from "../commit-message-provider.js";
import { cleanMessage, COMMIT_SYSTEM, commitPrompt, RECENT_SUBJECTS, SUGGEST_LIMITS } from "../commit-prompt.js";
import { InvalidProject, StaleReview } from "../errors.js";
import { gitDirectory } from "../git-directories.js";
import { diffDirectory, recentSubjects } from "../git.js";
import { isInsidePath } from "../git-diff.js";

/** More ticked files than this is a sweeping change; name it yourself. */
const MAX_PATHS = 500;

/**
 * A commit message for the ticked files, from one call to the chosen provider (see
 * `commit-message-provider.ts`): their diffs from `HEAD`, bounded, and the last ten
 * subjects for the repository's style. Nothing else is sent, the model has no tools,
 * and nothing is committed.
 */
export const suggestCommitMessage = Effect.fn("suggestCommitMessage")(function* (projectId: string, request: SuggestCommitMessageRequest) {
  const { directory } = yield* gitDirectory(projectId, request.directory);
  if (request.paths.length === 0) return yield* new InvalidProject({ message: "Tick at least one file" });
  if (request.paths.length > MAX_PATHS) return yield* new InvalidProject({ message: `Tick at most ${MAX_PATHS} files for a suggestion` });
  if (!request.paths.every(isInsidePath)) return yield* new InvalidProject({ message: "Paths must be relative and inside the working directory" });
  const ticked = new Set(request.paths);
  // Every diff, then only the ticked ones: the prompt's own budget decides what is left out.
  const files = (yield* diffDirectory(directory, SUGGEST_LIMITS, Number.POSITIVE_INFINITY)).filter((file) => ticked.has(file.path));
  if (files.length === 0) return yield* new StaleReview({ message: "None of the ticked files has changes now. Review the changes again." });
  const { prompt, truncated } = commitPrompt(files, yield* recentSubjects(directory, RECENT_SUBJECTS));
  const { adapter, provider } = yield* commitMessageProvider;
  const completion = yield* complete(adapter, { cwd: directory, model: provider.model, system: COMMIT_SYSTEM, prompt });
  return { message: cleanMessage(completion.text), provider, usage: completion.usage, truncated } satisfies SuggestCommitMessageResponse;
});
