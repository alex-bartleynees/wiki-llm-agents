import { ListSecretsResponse } from "@wiki-agents/contracts/secrets/list-secrets/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { guarded } from "../host-guard.js";
import { SecretStore } from "../secret-store.js";
import { secretUsers, summarise } from "../summaries.js";

/** Names, dates and which servers use each; never a value. */
export const listSecretsEndpoint = guarded(
  Effect.gen(function* () {
    const listed = yield* (yield* SecretStore).list;
    const usersOf = yield* secretUsers;
    return yield* HttpServerResponse.schemaJson(ListSecretsResponse)({
      secrets: listed.secrets.map((secret) => summarise(secret, usersOf(secret.name))),
      store: listed.store,
      problems: listed.problems,
    });
  }).pipe(Effect.catch(internalError("list secrets"))),
);
