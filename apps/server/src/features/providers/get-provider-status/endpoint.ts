import { GetProviderStatusRequest } from "@wiki-agents/contracts/providers/get-provider-status/request";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { ProviderRegistry } from "../registry.js";

/** Installed, a supported version, and starts; may start the provider's server, never a session. */
export const getProviderStatusEndpoint = Effect.gen(function* () {
  const { providerInstanceId } = yield* HttpRouter.schemaPathParams(GetProviderStatusRequest);
  const { adapter } = yield* (yield* ProviderRegistry).get(providerInstanceId);
  return yield* HttpServerResponse.schemaJson(GetProviderStatusResponse)({ status: yield* adapter.status });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProviderInstanceNotFound: () => Effect.succeed(notFound("Provider not found")),
  }),
  Effect.catch(internalError("get provider status")),
);
