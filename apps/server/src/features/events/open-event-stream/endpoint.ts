import { EventStreamFrame } from "@wiki-agents/contracts/events/event";
import { OpenEventStreamRequest } from "@wiki-agents/contracts/events/open-event-stream/request";
import { Effect, Schema, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { sseFrame, sseResponse } from "../../../shared/sse.js";
import { EventConnections } from "../connections.js";

const encode = Schema.encodeSync(Schema.fromJsonString(EventStreamFrame));

/** The connection lives as long as the response: when the browser goes, its subscriptions stop. */
export const openEventStreamEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(OpenEventStreamRequest);
  const connections = yield* EventConnections;
  return yield* sseResponse(Stream.unwrap(connections.open).pipe(Stream.map((frame) => sseFrame(encode(frame)))));
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("open event stream")),
);
