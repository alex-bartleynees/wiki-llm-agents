import { DraftInstructionsRequest } from "@wiki-agents/contracts/agents/draft-instructions/request";
import { DraftInstructionsResponse } from "@wiki-agents/contracts/agents/draft-instructions/response";
import { ByteSize, Effect } from "effect";
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { draftInstructions } from "./use-case.js";

const MAX_JSON_BYTES = ByteSize.fromInputUnsafe(256 * 1024);

export const draftInstructionsEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(DraftInstructionsRequest, { onExcessProperty: "error" }).pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_JSON_BYTES),
  );
  return yield* HttpServerResponse.schemaJson(DraftInstructionsResponse)(yield* draftInstructions(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest("Provide a provider, a model or its default, and an idea within the drafting limits.")),
    HttpServerError: () => Effect.succeed(badRequest()),
    ProviderInstanceNotFound: () => Effect.succeed(notFound("Draft provider is unavailable.")),
    DraftModelUnavailable: () => Effect.succeed(badRequest("The selected model is unavailable. Choose another model or the provider default.")),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("draft agent instructions")),
);
