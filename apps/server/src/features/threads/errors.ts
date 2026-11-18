import { Data } from "effect";

export class ThreadNotFound extends Data.TaggedError("ThreadNotFound")<{ readonly threadId: string }> {}

/** A turn is already running; one turn at a time per thread. */
export class ThreadBusy extends Data.TaggedError("ThreadBusy")<{ readonly threadId: string }> {}

/** The thread's conversation can't be compacted: `reason` says why (the provider can't, nothing to compact yet...). */
export class CompactionUnavailable extends Data.TaggedError("CompactionUnavailable")<{ readonly reason: string }> {}

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
