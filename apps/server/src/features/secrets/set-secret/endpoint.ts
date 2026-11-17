import { SetSecretRequest } from "@wiki-agents/contracts/secrets/set-secret/request";
import { SetSecretResponse } from "@wiki-agents/contracts/secrets/set-secret/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, unprocessable } from "../../../shared/http-errors.js";
import { guarded } from "../../../shared/host-guard.js";
import { SecretStore } from "../secret-store.js";
import { secretUsers, summarise } from "../summaries.js";

const Params = Schema.Struct({ name: Schema.String });

/** Stores the value encrypted; the response has the name and dates only. Failures are logged without the request. */
export const setSecretEndpoint = guarded(
  Effect.gen(function* () {
    const { name } = yield* HttpRouter.schemaPathParams(Params);
    const body = yield* HttpServerRequest.schemaBodyJson(SetSecretRequest);
    const secret = yield* (yield* SecretStore).set({ name, value: body.value, expiresAt: body.expiresAt });
    return yield* HttpServerResponse.schemaJson(SetSecretResponse)({ secret: summarise(secret, (yield* secretUsers)(name)) });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      SecretInvalid: (error) => Effect.succeed(unprocessable(error.problems)),
      SecretDeclared: (error) => Effect.succeed(conflict(`"${error.name}" is declared in the service's configuration (${error.path}); change it there.`)),
      SecretStoreUnavailable: (error) => Effect.succeed(conflict(error.reason)),
    }),
    Effect.catch(() => internalError("set secret")("(details withheld)")),
  ),
);
