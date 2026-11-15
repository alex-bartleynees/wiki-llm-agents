import type { ListedWorktree, ListWorktreesResponse } from "@wiki-agents/contracts/projects/list-worktrees/response";
import { removeWorktree } from "#lib/features/threads/api.ts";
import { listWorktrees } from "./api.ts";

/** A fresh branch name for a new thread's worktree: `wiki-agents/` and eight hex digits. */
export const suggestedBranch = () => `wiki-agents/${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

/**
 * Each project's thread worktrees and whether new threads can have one, loaded when a
 * screen needs them (New thread, the thread header, the overview) and again after a
 * worktree is made or removed.
 */
class WorktreesStore {
  #byProject = $state<Record<string, ListWorktreesResponse>>({});

  /** Whether new threads in the project can have a worktree; false until loaded. */
  available(projectId: string | null) {
    return projectId !== null && this.#byProject[projectId]?.available === true;
  }

  /** The project's worktrees, oldest first, removed ones included. */
  of(projectId: string): ReadonlyArray<ListedWorktree> {
    return this.#byProject[projectId]?.worktrees ?? [];
  }

  /** The thread's worktree, once its project's are loaded. */
  forThread(projectId: string | null, threadId: string): ListedWorktree | undefined {
    return projectId === null ? undefined : this.of(projectId).find((worktree) => worktree.threadId === threadId);
  }

  /** Loads (or reloads) the project's worktrees; a failure keeps what was shown. */
  async load(projectId: string) {
    try {
      this.#byProject[projectId] = await listWorktrees(projectId);
    } catch {
      // The option and headers stay as they were; the next load tries again.
    }
  }

  /** Removes the thread's worktree; fails with git's refusal (or a running turn) as the message. */
  async remove(projectId: string, threadId: string) {
    await removeWorktree(threadId);
    await this.load(projectId);
  }
}

export const worktrees = new WorktreesStore();
