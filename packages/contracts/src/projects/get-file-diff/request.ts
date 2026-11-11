import { Schema } from "effect";

/**
 * GET /api/projects/:projectId/diff/file?directory=...&path=...
 * One file's diff with a larger bound, for a file cut short in `get-diff`.
 */
export const GetFileDiffRequest = Schema.Struct({
  /** One of the project's working directories, exactly as the project lists it. */
  directory: Schema.String,
  /** Relative to `directory`, as `get-diff` gave it. */
  path: Schema.String,
});
export type GetFileDiffRequest = typeof GetFileDiffRequest.Type;
