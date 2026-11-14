import { UploadAttachmentResponse } from "@wiki-agents/contracts/attachments/upload-attachment/response";
import { postBytes } from "#lib/api/client.ts";

/** Keeps a file for a message to send (in the app's data folder, not a vault). */
export const uploadAttachment = (name: string, file: Blob) =>
  postBytes(`/api/attachments?name=${encodeURIComponent(name)}`, file, UploadAttachmentResponse);

/** Where an attachment is served: images inline, other files as a download. */
export const attachmentHref = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;
