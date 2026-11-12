import { Schema } from "effect";

export const DeleteNoteResponse = Schema.Struct({
  path: Schema.String,
  /** Where it went, vault-relative: `.trash/Coffee.md`, or `.trash/Coffee 1.md` when that was taken. */
  trashPath: Schema.String,
});
export type DeleteNoteResponse = typeof DeleteNoteResponse.Type;
