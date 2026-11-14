import { Schema } from "effect";

/**
 * GET /api/attachments/:attachmentId: the file's bytes, sandboxed like vault files.
 * Images show inline; other files download.
 */
export const GetAttachmentRequest = Schema.Struct({
  attachmentId: Schema.String.check(Schema.isNonEmpty()),
});
export type GetAttachmentRequest = typeof GetAttachmentRequest.Type;
