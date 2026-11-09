import { Schema } from "effect";
import { Pin } from "../model.js";

/** All of the vault's pins after unpinning, in the order they were pinned. */
export const UnpinNoteResponse = Schema.Struct({
  pins: Schema.Array(Pin),
});
export type UnpinNoteResponse = typeof UnpinNoteResponse.Type;
