import { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import { StreamInboxRequest } from "@wiki-agents/contracts/inbox/stream-inbox/request";
import { Effect, Schema, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { sseFrame, sseResponse } from "../../../shared/sse.js";
import { streamInbox } from "./use-case.js";

const encode = Schema.encodeSync(Schema.fromJsonString(InboxStreamMessage));

export const streamInboxEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(StreamInboxRequest);
  return yield* sseResponse((yield* streamInbox).pipe(Stream.map((message) => sseFrame(encode(message)))));
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("stream inbox")),
);
