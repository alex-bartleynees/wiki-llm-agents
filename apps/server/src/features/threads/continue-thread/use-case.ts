import type { ContinueThreadRequest } from "@wiki-agents/contracts/threads/continue-thread/request";
import type { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import { Effect, Option } from "effect";
import { threadWorktree, worktreeProblem } from "../../projects/worktrees.js";
import { createThread } from "../create-thread/use-case.js";
import { ContinueRefused } from "../errors.js";
import { findThread } from "../find-thread.js";
import { ThreadBus } from "../thread-bus.js";

const TITLE_LENGTH = 80;

/** "Continued: <the source's title>", as long as a title from a first message may be. */
export const continuedTitle = (title: string | null) => {
  const full = `Continued: ${title ?? "Untitled thread"}`;
  return full.length > TITLE_LENGTH ? `${full.slice(0, TITLE_LENGTH - 1)}…` : full;
};

/**
 * Continue in a new thread (Phase 3 of provider context and compaction): a new thread
 * with no provider session yet, so its first turn starts a fresh one. It keeps the
 * source's vault, project, provider, agent and model, and gets the reviewed handoff as
 * its composer draft; nothing is sent. The source thread is left as it is: its history,
 * its draft, and whether it's done.
 *
 * Where it works (`workspace`): `same` shares the source's worktree if it has one (both
 * then work in the same files), `main` is the project's main directory, and `worktree`
 * makes a new one from `HEAD`.
 */
export const continueThread = Effect.fn("continueThread")(function* (threadId: string, request: ContinueThreadRequest) {
  const source = yield* findThread(threadId);
  const workspace = request.workspace ?? "same";
  if (source.projectId === null && workspace !== "same") {
    return yield* new ContinueRefused({ reason: "Only a thread in a project can choose where the new thread works." });
  }
  const sourceWorktree = source.projectId === null ? null : Option.getOrNull(yield* threadWorktree(source.id));
  let shared = undefined;
  if (workspace === "same" && sourceWorktree !== null) {
    if ((yield* worktreeProblem(source.id)) !== null) {
      return yield* new ContinueRefused({
        reason: `This thread's worktree (branch ${sourceWorktree.branch}) is gone, so the new thread can't share it. Choose the project's main directory or a new worktree.`,
      });
    }
    shared = sourceWorktree;
  }
  const response: ContinueThreadResponse = yield* createThread(
    {
      vaultId: source.vaultId,
      ...(source.projectId === null ? {} : { projectId: source.projectId }),
      providerInstanceId: source.providerInstanceId,
      ...(source.agentId === null ? {} : { agentId: source.agentId }),
      ...(typeof workspace === "object" ? { worktree: workspace.worktree } : {}),
    },
    {
      title: continuedTitle(source.title),
      draftText: request.text,
      continuedFrom: source.id,
      model: source.model,
      ...(shared === undefined ? {} : { shareWorktree: shared }),
    },
  );
  // The source now links to it.
  yield* (yield* ThreadBus).publishThread(yield* findThread(source.id));
  return response;
});
