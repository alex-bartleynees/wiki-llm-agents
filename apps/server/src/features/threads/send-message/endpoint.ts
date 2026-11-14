import { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { sendMessage } from "./use-case.js";

const Params = Schema.Struct({ threadId: Schema.String });

/** The thread's actor records the message and starts the turn, one at a time. */
export const sendMessageEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SendMessageRequest);
  const turnId = yield* sendMessage(threadId, body);
  return yield* HttpServerResponse.schemaJson(SendMessageResponse)({ turnId }, { status: 202 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    InvalidVaultPath: () => Effect.succeed(badRequest("Invalid note path or stale selection")),
    VaultFileNotFound: () => Effect.succeed(notFound("Note not found")),
    ThreadBusy: () => Effect.succeed(conflict("A turn is already running")),
    EmptyMessage: () => Effect.succeed(badRequest("Write a message or attach a file")),
    AttachmentNotFound: () => Effect.succeed(badRequest("An attachment wasn't found; attach it again")),
  }),
  Effect.catch(internalError("send message")),
);
