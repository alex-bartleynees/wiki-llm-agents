import type { RunningTurn, ThreadStatus } from "@wiki-agents/contracts/threads/model";

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Needs you",
};

/** "2/5" */
export const progressLabel = (progress: NonNullable<RunningTurn["progress"]>) => `${progress.done}/${progress.total}`;

/** "1 subagent", "2 subagents": how many are at work, for a thread's row. */
export const subagentsLabel = (count: number) => `${count} ${count === 1 ? "subagent" : "subagents"}`;
