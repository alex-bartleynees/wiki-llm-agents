import { Data } from "effect";

export class ChangeNotFound extends Data.TaggedError("ChangeNotFound")<{ readonly changeId: string }> {}

/** The change was undone already. */
export class ChangeUndoneAlready extends Data.TaggedError("ChangeUndoneAlready")<{ readonly changeId: string }> {}

/** The file changed after the turn left it, so undo would lose those edits. */
export class ChangeConflict extends Data.TaggedError("ChangeConflict")<{ readonly changeId: string }> {}
