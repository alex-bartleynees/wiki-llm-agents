import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { deleteSecretEndpoint } from "./delete-secret/endpoint.js";
import { listSecretsEndpoint } from "./list-secrets/endpoint.js";
import { setSecretEndpoint } from "./set-secret/endpoint.js";

/** Write-only: no route returns a secret's value. */
export const secretsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/secrets", listSecretsEndpoint),
  HttpRouter.add("PUT", "/api/secrets/:name", setSecretEndpoint),
  HttpRouter.add("DELETE", "/api/secrets/:name", deleteSecretEndpoint),
);
