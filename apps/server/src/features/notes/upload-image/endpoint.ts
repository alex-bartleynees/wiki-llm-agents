import { MAX_IMAGE_BYTES, UploadImageRequest } from "@wiki-agents/contracts/notes/upload-image/request";
import { UploadImageResponse } from "@wiki-agents/contracts/notes/upload-image/response";
import { ByteSize, Effect } from "effect";
import { HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { uploadImage } from "./use-case.js";

const tooLarge = () => HttpServerResponse.text("Images are limited to 20 MB", { status: 413 });

/** The vault and file name from the URL, the image's bytes as the body. */
export const uploadImageEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(UploadImageRequest);
  const http = yield* HttpServerRequest.HttpServerRequest;
  if (Number(http.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) return tooLarge();
  const body = yield* http.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.fromInputUnsafe(MAX_IMAGE_BYTES)),
  );
  const response = yield* uploadImage({ ...request, bytes: new Uint8Array(body) });
  return yield* HttpServerResponse.schemaJson(UploadImageResponse)(response, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(tooLarge()),
    InvalidImage: (error) => Effect.succeed(badRequest(error.reason)),
    InvalidVaultPath: () => Effect.succeed(badRequest("The assets folder isn't usable")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("upload image")),
);
