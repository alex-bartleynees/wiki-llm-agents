import { TestDeviceParams } from "@wiki-agents/contracts/notifications/test-device/request";
import { TestDeviceResponse } from "@wiki-agents/contracts/notifications/test-device/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { testDevice } from "./use-case.js";

export const testDeviceEndpoint = Effect.gen(function* () {
  const { deviceId } = yield* HttpRouter.schemaPathParams(TestDeviceParams);
  const response: TestDeviceResponse = yield* testDevice(deviceId);
  return yield* HttpServerResponse.schemaJson(TestDeviceResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    DeviceNotFound: () => Effect.succeed(notFound("Device not found")),
  }),
  Effect.catch(internalError("test push device")),
);
