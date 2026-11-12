import { AddDeviceRequest } from "@wiki-agents/contracts/notifications/add-device/request";
import { AddDeviceResponse } from "@wiki-agents/contracts/notifications/add-device/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { WallClock } from "../../../shared/wall-clock.js";
import { NotificationsRepository } from "../repository.js";

export const addDeviceEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(AddDeviceRequest);
  const at = yield* (yield* WallClock).now;
  const device = yield* (yield* NotificationsRepository).putDevice(
    { endpoint: request.endpoint, p256dh: request.keys.p256dh, auth: request.keys.auth, name: request.name.trim() || "Browser" },
    at,
  );
  const response: AddDeviceResponse = { device };
  return yield* HttpServerResponse.schemaJson(AddDeviceResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("add push device")),
);
