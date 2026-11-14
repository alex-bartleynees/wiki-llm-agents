import { MAX_ATTACHMENT_BYTES } from "@wiki-agents/contracts/attachments/model";
import { UploadAttachmentRequest } from "@wiki-agents/contracts/attachments/upload-attachment/request";
import { UploadAttachmentResponse } from "@wiki-agents/contracts/attachments/upload-attachment/response";
import { ByteSize, Effect } from "effect";
import { HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { AttachmentStore } from "../attachment-store.js";

const tooLarge = () => HttpServerResponse.text("Attachments are limited to 100 MB", { status: 413 });

/** The file name from the URL, the file's bytes as the body. */
export const uploadAttachmentEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(UploadAttachmentRequest);
  const http = yield* HttpServerRequest.HttpServerRequest;
  if (Number(http.headers["content-length"] ?? 0) > MAX_ATTACHMENT_BYTES) return tooLarge();
  const body = yield* http.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.fromInputUnsafe(MAX_ATTACHMENT_BYTES)),
  );
  const { path: _path, ...attachment } = yield* (yield* AttachmentStore).save(request.name, new Uint8Array(body));
  return yield* HttpServerResponse.schemaJson(UploadAttachmentResponse)(attachment, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(tooLarge()),
    InvalidAttachment: (error) => Effect.succeed(badRequest(error.reason)),
  }),
  Effect.catch(internalError("upload attachment")),
);
