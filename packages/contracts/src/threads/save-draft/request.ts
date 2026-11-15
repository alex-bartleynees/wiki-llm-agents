import { Schema } from "effect";

const Counter = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
/** A writer's increasing sequence keeps unload saves safe even when requests arrive out of order. */
export const SaveDraftRequest = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  baseVersion: Counter,
  writerId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100)),
  sequence: Counter,
});
export type SaveDraftRequest = typeof SaveDraftRequest.Type;
