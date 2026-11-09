import { Data } from "effect";

export class ThreadNotFound extends Data.TaggedError("ThreadNotFound")<{ readonly threadId: string }> {}

/** A turn is already running; one turn at a time per thread. */
export class ThreadBusy extends Data.TaggedError("ThreadBusy")<{ readonly threadId: string }> {}

export class NoTurnRunning extends Data.TaggedError("NoTurnRunning")<{ readonly threadId: string }> {}

export class RequestNotFound extends Data.TaggedError("RequestNotFound")<{ readonly requestId: string }> {}

/** Already answered, or cancelled when its turn ended. */
export class RequestClosed extends Data.TaggedError("RequestClosed")<{
  readonly requestId: string;
  readonly status: "answered" | "cancelled";
}> {}

/** An approval answered with text, or a question with a decision. */
export class WrongAnswerKind extends Data.TaggedError("WrongAnswerKind")<{ readonly requestId: string }> {}
