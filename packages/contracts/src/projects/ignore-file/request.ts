import { Schema } from "effect";

/**
 * POST /api/projects/:projectId/diff/ignored with this body. Sets the file aside in
 * the diff review; ignoring an ignored file changes nothing.
 */
export const IgnoreFileRequest = Schema.Struct({
  /** One of the project's working directories, exactly as the project lists it. */
  directory: Schema.String,
  /** Relative to `directory`, as `get-diff` gave it. */
  path: Schema.String,
});
export type IgnoreFileRequest = typeof IgnoreFileRequest.Type;
