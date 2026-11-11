import { Schema } from "effect";
import { DirectoryDiff } from "../model.js";

export const GetDiffResponse = Schema.Struct({
  /** Every working directory, in the project's order. */
  directories: Schema.Array(DirectoryDiff),
});
export type GetDiffResponse = typeof GetDiffResponse.Type;
