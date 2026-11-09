import { StreamVaultEventsRequest } from "@wiki-agents/contracts/indexing/stream-vault-events/request";
import { Effect, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { streamVaultEvents } from "./use-case.js";

export const streamVaultEventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(StreamVaultEventsRequest);
  const frames = yield* streamVaultEvents(request);
  return HttpServerResponse.stream(Stream.encodeText(frames), {
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("stream vault events")),
);
