import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getAttachmentEndpoint } from "./get-attachment/endpoint.js";
import { uploadAttachmentEndpoint } from "./upload-attachment/endpoint.js";

export const attachmentsRouter = Layer.mergeAll(
  HttpRouter.add("POST", "/api/attachments", uploadAttachmentEndpoint),
  HttpRouter.add("GET", "/api/attachments/:attachmentId", getAttachmentEndpoint),
);
