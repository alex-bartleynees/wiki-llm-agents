import type { RemoveWorktreeResponse } from "@wiki-agents/contracts/threads/remove-worktree/response";
import { Effect, Option } from "effect";
import { removeThreadWorktree, threadsInWorktree } from "../../projects/worktrees.js";
import { type ThreadBusy, WorktreeInUse } from "../errors.js";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";
import { ThreadActors } from "../thread-actors.js";

/**
 * Removes the thread's worktree between turns, through the actors of every thread
 * working in it (a continued thread may share it), so no turn starts in a folder git
 * is removing. Refused while a turn runs or waits in any of them. The actors are held
 * in a fixed order (by id), so two removals asked at once can't wait on each other.
 */
export const removeWorktree = Effect.fn("removeWorktree")(function* (threadId: string) {
  const thread = yield* findThread(threadId);
  const remove = removeThreadWorktree(thread.id).pipe(Effect.provideContext(yield* Effect.context<Effect.Services<ReturnType<typeof removeThreadWorktree>>>()));
  const repository = yield* ThreadRepository;
  // Threads deleted since have no actor to hold.
  const others = yield* Effect.filter(yield* threadsInWorktree(thread.id), (id) =>
    id === thread.id ? Effect.succeed(false) : Effect.map(repository.find(id), Option.isSome),
  );
  const [first, ...rest] = [thread.id, ...others].sort();
  const actors = yield* ThreadActors;
  // The innermost hold is the last thread in order; each one before wraps it.
  let held = actors.whileIdle(rest.at(-1) ?? first!, remove);
  for (const id of [first!, ...rest].slice(0, -1).reverse()) held = actors.whileIdle(id, held);
  const worktree = yield* held.pipe(
    Effect.catchTag("ThreadBusy", (busy) => Effect.fail<ThreadBusy | WorktreeInUse>(busy.threadId === thread.id ? busy : new WorktreeInUse({ threadId: busy.threadId }))),
  );
  return { worktree } satisfies RemoveWorktreeResponse;
});
