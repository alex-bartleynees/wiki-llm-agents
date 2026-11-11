import { Data } from "effect";

/** The request can't make or use a project; `message` says why and is shown to the user. */
export class InvalidProject extends Data.TaggedError("InvalidProject")<{ readonly message: string }> {}

export class ProjectNotFound extends Data.TaggedError("ProjectNotFound")<{ readonly projectId: string }> {}

/** The file has no changes from `HEAD` (or no longer exists). */
export class FileDiffNotFound extends Data.TaggedError("FileDiffNotFound")<{ readonly path: string }> {}
