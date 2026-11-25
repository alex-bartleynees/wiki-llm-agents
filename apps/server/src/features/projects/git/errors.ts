import { Data } from "effect";

/** git said no (a hook failed, the push was rejected, it took too long); `message` is git's own, for the user. */
export class GitRefused extends Data.TaggedError("GitRefused")<{ readonly message: string }> {}

export class GitFailed extends Data.TaggedError("GitFailed")<{ readonly message: string; readonly cause?: unknown }> {}
