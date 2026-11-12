import { UpdatePreferencesRequest } from "@wiki-agents/contracts/notifications/update-preferences/request";
import { UpdatePreferencesResponse } from "@wiki-agents/contracts/notifications/update-preferences/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { DigestSignal } from "../digest.js";
import { NotificationsRepository } from "../repository.js";

export const updatePreferencesEndpoint = Effect.gen(function* () {
  const { preferences } = yield* HttpServerRequest.schemaBodyJson(UpdatePreferencesRequest);
  yield* (yield* NotificationsRepository).savePreferences(preferences);
  // The digest time may have moved.
  yield* (yield* DigestSignal).wake;
  const response: UpdatePreferencesResponse = { preferences };
  return yield* HttpServerResponse.schemaJson(UpdatePreferencesResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("update notification preferences")),
);
