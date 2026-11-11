import { Schema } from "effect";

export const UndoChangeResponse = Schema.Struct({
  changeId: Schema.String,
  /** Milliseconds since the epoch. */
  undoneAt: Schema.Number,
});
export type UndoChangeResponse = typeof UndoChangeResponse.Type;
