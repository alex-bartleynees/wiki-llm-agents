import { Schema } from "effect";

/** Image types every provider takes as image input; anything else goes as a file. */
export const IMAGE_INPUT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Largest image sent as an image (Claude's per-image limit); a larger one goes as a file. */
export const MAX_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;

/** Largest attachment of any kind, in bytes. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** Attachments on one message. */
export const MAX_ATTACHMENTS = 10;

/**
 * A file sent with a message, kept in the app's data folder (not a vault). An
 * `image` reaches the model as an image; a `file` is listed in the message by path,
 * for the agent to read with its own tools.
 */
export const Attachment = Schema.Struct({
  id: Schema.String,
  /** The file's name as it was sent, cleaned of folders and control characters. */
  name: Schema.String,
  /** `image/png`, `text/csv`... `application/octet-stream` when unknown. */
  mime: Schema.String,
  /** In bytes. */
  size: Schema.Number,
  kind: Schema.Literals(["image", "file"]),
});
export type Attachment = typeof Attachment.Type;
