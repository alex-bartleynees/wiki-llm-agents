import { Schema } from "effect";

/** The changed-file list is empty straight after; `files` is how many the new baseline holds. */
export const ReviewChangesResponse = Schema.Struct({ files: Schema.Number });
export type ReviewChangesResponse = typeof ReviewChangesResponse.Type;
