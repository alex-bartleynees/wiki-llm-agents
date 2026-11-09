import { Schema } from "effect";
import { Pin } from "../model.js";

/** The vault's pins in the order they were pinned. */
export const ListPinsResponse = Schema.Struct({
  pins: Schema.Array(Pin),
});
export type ListPinsResponse = typeof ListPinsResponse.Type;
