import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getProviderStatusEndpoint } from "./get-provider-status/endpoint.js";
import { listProvidersEndpoint } from "./list-providers/endpoint.js";

export const providersRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/providers", listProvidersEndpoint),
  HttpRouter.add("GET", "/api/providers/:providerInstanceId/status", getProviderStatusEndpoint),
);
