import { HttpRouter } from "effect/http";
import { listProvidersEndpoint } from "./list-providers/endpoint.js";

export const providersRouter = HttpRouter.add("GET", "/api/providers", listProvidersEndpoint);
