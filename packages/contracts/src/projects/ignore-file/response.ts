import { Schema } from "effect";
import { IgnoredFile } from "../model.js";

/** The project's ignored files after ignoring, in the order they were ignored. */
export const IgnoreFileResponse = Schema.Struct({
  ignored: Schema.Array(IgnoredFile),
});
export type IgnoreFileResponse = typeof IgnoreFileResponse.Type;
