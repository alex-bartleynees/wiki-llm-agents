import { StreamThreadEventsRequest } from "@wiki-agents/contracts/threads/stream-thread-events/request";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { sseResponse } from "../../../shared/sse.js";
import { streamThreadEvents } from "./use-case.js";

const LastEventId = Schema.Struct({ "last-event-id": StreamThreadEventsRequest.fields.after });

/** EventSource sends the last seq it saw as `Last-Event-ID` when it reconnects; that wins over `after`. */
export const streamThreadEventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaParams(StreamThreadEventsRequest);
  const headers = yield* HttpServerRequest.schemaHeaders(LastEventId);
  const after = headers["last-event-id"] ?? request.after;
  return sseResponse(yield* streamThreadEvents({ threadId: request.threadId, ...(after === undefined ? {} : { after }) }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("stream thread events")),
);
