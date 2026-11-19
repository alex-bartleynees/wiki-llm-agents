import { Data } from "effect";

export class ThreadNotFound extends Data.TaggedError("ThreadNotFound")<{ readonly threadId: string }> {}

/** A turn is already running; one turn at a time per thread. */
export class ThreadBusy extends Data.TaggedError("ThreadBusy")<{ readonly threadId: string }> {}

/** The thread's conversation can't be compacted: `reason` says why (the provider can't, nothing to compact yet...). */
export class CompactionUnavailable extends Data.TaggedError("CompactionUnavailable")<{ readonly reason: string }> {}

/** The agent can't be asked for a handoff now: `reason` says why (nothing to hand off yet, the provider is gone...). */
export class HandoffUnavailable extends Data.TaggedError("HandoffUnavailable")<{ readonly reason: string }> {}

/** The thread can't be continued as asked: `reason` says why (its worktree is gone, say). */
export class ContinueRefused extends Data.TaggedError("ContinueRefused")<{ readonly reason: string }> {}

/** Another thread sharing the worktree has a turn running or waiting, so it can't be removed now. */
export class WorktreeInUse extends Data.TaggedError("WorktreeInUse")<{ readonly threadId: string }> {}

export class NoTurnRunning extends Data.TaggedError("NoTurnRunning")<{ readonly threadId: string }> {}

export class RequestNotFound extends Data.TaggedError("RequestNotFound")<{ readonly requestId: string }> {}

/** Already answered, or cancelled when its turn ended. */
export class RequestClosed extends Data.TaggedError("RequestClosed")<{
  readonly requestId: string;
  readonly status: "answered" | "cancelled";
}> {}

/** A call to another MCP server's tool may not run; `message` is what the agent is told. */
export class ToolCallRefused extends Data.TaggedError("ToolCallRefused")<{ readonly message: string }> {}

/** An approval answered with text, or a question with a decision. */
export class WrongAnswerKind extends Data.TaggedError("WrongAnswerKind")<{ readonly requestId: string }> {}
