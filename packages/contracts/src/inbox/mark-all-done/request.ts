import { Schema } from "effect";

export const MarkAllDoneTarget = Schema.Struct({
  itemId: Schema.NonEmptyString,
  turnId: Schema.NullOr(Schema.NonEmptyString),
});
export type MarkAllDoneTarget = typeof MarkAllDoneTarget.Type;

/** POST /api/inbox/done: the items captured when confirmation opened. */
export const MarkAllDoneRequest = Schema.Struct({ targets: Schema.Array(MarkAllDoneTarget) });
export type MarkAllDoneRequest = typeof MarkAllDoneRequest.Type;
