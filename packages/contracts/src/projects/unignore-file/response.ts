import { Schema } from "effect";
import { IgnoredFile } from "../model.js";

/** The project's ignored files after the change, in the order they were ignored. */
export const UnignoreFileResponse = Schema.Struct({
  ignored: Schema.Array(IgnoredFile),
});
export type UnignoreFileResponse = typeof UnignoreFileResponse.Type;
