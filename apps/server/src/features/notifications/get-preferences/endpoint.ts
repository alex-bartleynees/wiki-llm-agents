import { GetPreferencesRequest } from "@wiki-agents/contracts/notifications/get-preferences/request";
import { GetPreferencesResponse } from "@wiki-agents/contracts/notifications/get-preferences/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { NotificationsRepository } from "../repository.js";

export const getPreferencesEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(GetPreferencesRequest);
  const response: GetPreferencesResponse = { preferences: yield* (yield* NotificationsRepository).preferences };
  return yield* HttpServerResponse.schemaJson(GetPreferencesResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("get notification preferences")),
);
