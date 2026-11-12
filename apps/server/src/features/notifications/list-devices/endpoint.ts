import { ListDevicesRequest } from "@wiki-agents/contracts/notifications/list-devices/request";
import { ListDevicesResponse } from "@wiki-agents/contracts/notifications/list-devices/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { NotificationsRepository } from "../repository.js";

export const listDevicesEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListDevicesRequest);
  const response: ListDevicesResponse = { devices: yield* (yield* NotificationsRepository).devices };
  return yield* HttpServerResponse.schemaJson(ListDevicesResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("list push devices")),
);
