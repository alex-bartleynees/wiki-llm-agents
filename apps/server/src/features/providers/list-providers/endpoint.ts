import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { ProviderRegistry } from "../registry.js";

export const listProvidersEndpoint = Effect.gen(function* () {
  const providers = yield* (yield* ProviderRegistry).list;
  return yield* HttpServerResponse.schemaJson(ListProvidersResponse)({ providers });
}).pipe(Effect.catch(internalError("list providers")));
