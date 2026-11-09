import { Schema } from "effect";
import { TreeEntry } from "../model.js";

/** Every visible file in the vault, sorted by path. Folders are implied by the paths. */
export const GetTreeResponse = Schema.Struct({
  entries: Schema.Array(TreeEntry),
});
export type GetTreeResponse = typeof GetTreeResponse.Type;
