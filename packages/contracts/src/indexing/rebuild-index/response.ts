import { Schema } from "effect";

export const RebuildIndexResponse = Schema.Struct({
  files: Schema.Number,
  notes: Schema.Number,
});
export type RebuildIndexResponse = typeof RebuildIndexResponse.Type;
