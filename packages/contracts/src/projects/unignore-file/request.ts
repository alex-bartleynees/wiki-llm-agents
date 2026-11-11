import { Schema } from "effect";

/**
 * DELETE /api/projects/:projectId/diff/ignored?directory=...&path=...
 * Brings the file back into the diff review; for a file that isn't ignored it changes nothing.
 */
export const UnignoreFileRequest = Schema.Struct({
  directory: Schema.String,
  path: Schema.String,
});
export type UnignoreFileRequest = typeof UnignoreFileRequest.Type;
