import type { RemoveWorktreeResponse } from "@wiki-agents/contracts/threads/remove-worktree/response";
import { Effect } from "effect";
import { removeThreadWorktree } from "../../projects/worktrees.js";
import { findThread } from "../find-thread.js";
import { ThreadActors } from "../thread-actors.js";

/**
 * Removes the thread's worktree between its turns, through its actor, so no turn
 * starts in a folder git is removing. Refused while a turn runs or waits.
 */
export const removeWorktree = Effect.fn("removeWorktree")(function* (threadId: string) {
  const thread = yield* findThread(threadId);
  const remove = removeThreadWorktree(thread.id).pipe(Effect.provideContext(yield* Effect.context<Effect.Services<ReturnType<typeof removeThreadWorktree>>>()));
  const worktree = yield* (yield* ThreadActors).whileIdle(thread.id, remove);
  return { worktree } satisfies RemoveWorktreeResponse;
});
