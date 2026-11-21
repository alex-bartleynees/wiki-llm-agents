import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Data, Effect, Option } from "effect";
import { threadWorktree, worktreeProblem } from "../projects/worktrees.js";
import { createThread } from "./create-thread/use-case.js";
import { finalReply } from "./final-reply.js";
import { findThread } from "./find-thread.js";
import { ThreadRepository } from "./repository.js";
import { ThreadActors } from "./thread-actors.js";

const ACTIVE_CHILD_LIMIT = 4;

export class DelegationRefused extends Data.TaggedError("DelegationRefused")<{ readonly message: string }> {}

const checkCapacity = Effect.fnUntraced(function* (managerId: string) {
  const children = yield* (yield* ThreadRepository).listChildren(managerId);
  if (children.filter((child) => child.status !== "idle" || child.subagentsActive > 0).length >= ACTIVE_CHILD_LIMIT) {
    return yield* new DelegationRefused({ message: "Four child threads are already active. Wait for one to finish." });
  }
});

const ownedChild = Effect.fnUntraced(function* (managerId: string, childId: string) {
  const child = yield* (yield* ThreadRepository).find(childId);
  if (Option.isNone(child) || child.value.parentThreadId !== managerId) {
    return yield* new DelegationRefused({ message: "That thread is not one of this manager's children." });
  }
  return child.value;
});

export const startChildThread = Effect.fnUntraced(function* (
  manager: ThreadSummary,
  input: { readonly title: string; readonly prompt: string; readonly agentId?: string; readonly providerInstanceId?: string; readonly model?: string },
  unattended: boolean,
) {
  yield* checkCapacity(manager.id);
  const shareWorktree = manager.projectId === null ? undefined : Option.getOrUndefined(yield* threadWorktree(manager.id));
  if (shareWorktree !== undefined && (yield* worktreeProblem(manager.id)) !== null) {
    return yield* new DelegationRefused({ message: "The manager's worktree is unavailable." });
  }
  const agentId = input.agentId ?? manager.agentId;
  const providerInstanceId = input.providerInstanceId ?? (input.agentId === undefined ? manager.providerInstanceId : undefined);
  const { thread } = yield* createThread({
    vaultId: manager.vaultId,
    ...(manager.projectId === null ? {} : { projectId: manager.projectId }),
    ...(agentId === null ? {} : { agentId }),
    ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
    ...(input.model === undefined ? {} : { model: input.model }),
  }, {
    title: input.title,
    parentThreadId: manager.id,
    ...(shareWorktree === undefined ? {} : { shareWorktree }),
  });
  const turnId = yield* (yield* ThreadActors).sendMessage(thread.id, input.prompt, [], { unattended });
  return { threadId: thread.id, turnId };
});

export const listChildThreads = Effect.fnUntraced(function* (managerId: string) {
  return yield* (yield* ThreadRepository).listChildren(managerId);
});

export const readChildThread = Effect.fnUntraced(function* (managerId: string, childId: string) {
  yield* ownedChild(managerId, childId);
  const events = (yield* (yield* ThreadRepository).events(childId, 0)).map(({ event }) => event);
  const last = events.findLast((event) => event._tag === "turn.finished");
  return { reply: last === undefined ? null : finalReply(events, last.turnId), outcome: last?.outcome ?? null };
});

export const sendToChildThread = Effect.fnUntraced(function* (managerId: string, childId: string, prompt: string, unattended: boolean) {
  const child = yield* ownedChild(managerId, childId);
  if (child.status !== "idle" || child.subagentsActive > 0) {
    return yield* new DelegationRefused({ message: "This child is still active. Wait for it to finish." });
  }
  yield* checkCapacity(managerId);
  const turnId = yield* (yield* ThreadActors).sendMessage(child.id, prompt, [], { unattended });
  return { threadId: child.id, turnId };
});
