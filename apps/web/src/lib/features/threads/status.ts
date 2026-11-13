import type { RunningTurn, ThreadStatus } from "@wiki-agents/contracts/threads/model";

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Needs you",
};

/** "2/5" */
export const progressLabel = (progress: NonNullable<RunningTurn["progress"]>) => `${progress.done}/${progress.total}`;
