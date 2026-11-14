import { GetAttachmentRequest } from "@wiki-agents/contracts/attachments/get-attachment/request";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { downloadDisposition, STATIC_FILE_POLICY, UNTRUSTED_HEADERS } from "../../../shared/untrusted-files.js";
import { AttachmentStore } from "../attachment-store.js";

/** Images show inline; every other file downloads under its name, never rendered. */
export const getAttachmentEndpoint = Effect.gen(function* () {
  const { attachmentId } = yield* HttpRouter.schemaParams(GetAttachmentRequest);
  const [attachment] = yield* (yield* AttachmentStore).find([attachmentId]);
  const image = attachment!.mime.startsWith("image/");
  return yield* HttpServerResponse.file(attachment!.path, {
    contentType: image ? attachment!.mime : "application/octet-stream",
    headers: {
      ...UNTRUSTED_HEADERS,
      "content-security-policy": STATIC_FILE_POLICY,
      "content-disposition": image ? "inline" : downloadDisposition(attachment!.name),
    },
  });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    AttachmentNotFound: () => Effect.succeed(notFound("Attachment not found")),
  }),
  Effect.catch(internalError("get attachment")),
);
