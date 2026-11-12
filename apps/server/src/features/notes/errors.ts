import { Data } from "effect";

/** The note isn't the version the edit started from (changed, deleted, or created meanwhile). */
export class NoteChangedOnDisk extends Data.TaggedError("NoteChangedOnDisk")<{
  readonly path: string;
}> {}
