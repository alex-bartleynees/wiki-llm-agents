import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import { StreamVaultEventsRequest } from "@wiki-agents/contracts/indexing/stream-vault-events/request";
import { Effect, Schema, Stream } from "effect";
import { HttpRouter } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { sseFrame, sseResponse } from "../../../shared/sse.js";
import { streamVaultEvents } from "./use-case.js";

const encode = Schema.encodeSync(Schema.fromJsonString(VaultEvent));

export const streamVaultEventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(StreamVaultEventsRequest);
  return yield* sseResponse((yield* streamVaultEvents(request)).pipe(Stream.map((event) => sseFrame(encode(event)))));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("stream vault events")),
);
