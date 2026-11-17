import { DeleteSecretRequest } from "@wiki-agents/contracts/secrets/delete-secret/request";
import { DeleteSecretResponse } from "@wiki-agents/contracts/secrets/delete-secret/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { guarded } from "../../../shared/host-guard.js";
import { SecretStore } from "../secret-store.js";
import { secretUsers } from "../summaries.js";

/** Forgets a stored secret, unless servers still refer to it and `force` isn't set. */
export const deleteSecretEndpoint = guarded(
  Effect.gen(function* () {
    const request = yield* HttpRouter.schemaParams(DeleteSecretRequest);
    const users = (yield* secretUsers)(request.name);
    if (users.length > 0 && request.force !== "true") {
      return conflict(`Still used by ${users.join(", ")}. Change those servers first, or delete it anyway and they will have no secret.`);
    }
    yield* (yield* SecretStore).delete(request.name);
    return yield* HttpServerResponse.schemaJson(DeleteSecretResponse)({ stillUsedBy: users });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      SecretNotFound: () => Effect.succeed(notFound("No stored secret of that name")),
      SecretDeclared: (error) => Effect.succeed(conflict(`"${error.name}" is declared in the service's configuration (${error.path}); remove it there.`)),
      SecretStoreUnavailable: (error) => Effect.succeed(conflict(error.reason)),
    }),
    Effect.catch(internalError("delete secret")),
  ),
);
