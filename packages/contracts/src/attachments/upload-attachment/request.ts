import { Schema } from "effect";

/**
 * POST /api/attachments?name=… with the file's bytes as the body (up to
 * `MAX_ATTACHMENT_BYTES`, 413 past it): keeps the file for a message to send. The
 * same bytes under the same name give back the same attachment.
 */
export const UploadAttachmentRequest = Schema.Struct({
  /** The file's name, e.g. `Pasted image 20261114101500.png` or `query_data.csv`. */
  name: Schema.String.check(Schema.isNonEmpty()),
});
export type UploadAttachmentRequest = typeof UploadAttachmentRequest.Type;
