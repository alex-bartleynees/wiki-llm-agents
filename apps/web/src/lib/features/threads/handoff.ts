import type { ContinueWorkspace } from "@wiki-agents/contracts/threads/continue-thread/request";

/**
 * The headings of a handoff, for writing one yourself. They match what the app asks
 * the agent for (`apps/server/src/features/threads/handoff-prompt.ts`).
 */
export const HANDOFF_HEADINGS = ["Objective", "Decisions", "Files changed", "Checks run", "Unfinished work", "Relevant paths"] as const;

export const HANDOFF_TEMPLATE = HANDOFF_HEADINGS.map((heading) => `## ${heading}\n\n`).join("\n");

/** Where the new thread works, as the dialog offers it. */
export type WorkspaceChoice = "same" | "main" | "worktree";

/** The request's `workspace` for a choice; a new worktree needs its branch. */
export const workspaceOf = (choice: WorkspaceChoice, branch: string): ContinueWorkspace =>
  choice === "worktree" ? { worktree: { branch: branch.trim() } } : choice;
