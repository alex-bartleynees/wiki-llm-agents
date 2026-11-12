import { StreamInboxRequest } from "@wiki-agents/contracts/inbox/stream-inbox/request";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { sseResponse } from "../../../shared/sse.js";
import { streamInbox } from "./use-case.js";

export const streamInboxEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(StreamInboxRequest);
  return yield* sseResponse(yield* streamInbox);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("stream inbox")),
);
