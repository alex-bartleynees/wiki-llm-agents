import { Schema } from "effect";
import { Pin } from "../model.js";

/** All of the vault's pins after pinning, in the order they were pinned. */
export const PinNoteResponse = Schema.Struct({
  pins: Schema.Array(Pin),
});
export type PinNoteResponse = typeof PinNoteResponse.Type;
