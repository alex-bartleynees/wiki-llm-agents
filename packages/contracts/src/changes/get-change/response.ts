import { Schema } from "effect";
import { Attribution, ChangeKind } from "../model.js";

export const GetChangeResponse = Schema.Struct({
  id: Schema.String,
  vaultId: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  path: Schema.String,
  change: ChangeKind,
  attribution: Attribution,
  /** Content before the turn; null when the turn created the file. */
  before: Schema.NullOr(Schema.String),
  /** Content the turn left; null when it deleted the file. */
  after: Schema.NullOr(Schema.String),
  /** Content on disk now; null when there is no file. */
  current: Schema.NullOr(Schema.String),
  /** The file still matches what the turn left, so undo can run. */
  undoable: Schema.Boolean,
  /** Milliseconds since the epoch; null until undone. */
  undoneAt: Schema.NullOr(Schema.Number),
});
export type GetChangeResponse = typeof GetChangeResponse.Type;
