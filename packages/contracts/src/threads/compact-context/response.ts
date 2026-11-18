import { Schema } from "effect";

/**
 * The compaction's turn; how it goes arrives on the thread's stream. `started` is
 * false when this operation id had already started it (a retry).
 */
export const CompactContextResponse = Schema.Struct({
  turnId: Schema.String,
  started: Schema.Boolean,
});
export type CompactContextResponse = typeof CompactContextResponse.Type;
