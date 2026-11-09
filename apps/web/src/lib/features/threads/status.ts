import type { ThreadStatus } from "@wiki-agents/contracts/threads/model";

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Needs you",
};
