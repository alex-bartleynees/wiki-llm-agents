import { RemoveDeviceParams } from "@wiki-agents/contracts/notifications/remove-device/request";
import { RemoveDeviceResponse } from "@wiki-agents/contracts/notifications/remove-device/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { DeviceNotFound } from "../errors.js";
import { NotificationsRepository } from "../repository.js";

export const removeDeviceEndpoint = Effect.gen(function* () {
  const { deviceId } = yield* HttpRouter.schemaPathParams(RemoveDeviceParams);
  const removed = yield* (yield* NotificationsRepository).removeDevice(deviceId);
  if (!removed) return yield* new DeviceNotFound({ deviceId });
  const response: RemoveDeviceResponse = {};
  return yield* HttpServerResponse.schemaJson(RemoveDeviceResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    DeviceNotFound: () => Effect.succeed(notFound("Device not found")),
  }),
  Effect.catch(internalError("remove push device")),
);
