import { StreamVaultEventsRequest } from "@wiki-agents/contracts/indexing/stream-vault-events/request";
import { Effect } from "effect";
import { HttpRouter } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { sseResponse } from "../../../shared/sse.js";
import { streamVaultEvents } from "./use-case.js";

export const streamVaultEventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(StreamVaultEventsRequest);
  return yield* sseResponse(yield* streamVaultEvents(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("stream vault events")),
);
