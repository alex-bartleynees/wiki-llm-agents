import { Attachment } from "../model.js";

/** 201: the kept file, to list in a message's `attachments`. */
export const UploadAttachmentResponse = Attachment;
export type UploadAttachmentResponse = typeof UploadAttachmentResponse.Type;
