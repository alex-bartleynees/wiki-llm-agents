import { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import { StreamThreadEventsRequest } from "@wiki-agents/contracts/threads/stream-thread-events/request";
import { Effect, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { sseFrame, sseResponse } from "../../../shared/sse.js";
import { streamThreadEvents } from "./use-case.js";

const LastEventId = Schema.Struct({ "last-event-id": StreamThreadEventsRequest.fields.after });
const encode = Schema.encodeSync(Schema.fromJsonString(ThreadStreamMessage));

/** EventSource sends the last seq it saw as `Last-Event-ID` when it reconnects; that wins over `after`. */
export const streamThreadEventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(StreamThreadEventsRequest);
  const headers = yield* HttpServerRequest.schemaHeaders(LastEventId);
  const after = headers["last-event-id"] ?? request.after;
  const messages = yield* streamThreadEvents({ threadId: request.threadId, ...(after === undefined ? {} : { after }) });
  // A stored event's frame id is its seq.
  return yield* sseResponse(messages.pipe(Stream.map((message) => sseFrame(encode(message), message.type === "event" ? message.event.seq : undefined))));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("stream thread events")),
);
