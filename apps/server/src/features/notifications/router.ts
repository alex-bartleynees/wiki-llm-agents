import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { addDeviceEndpoint } from "./add-device/endpoint.js";
import { getPreferencesEndpoint } from "./get-preferences/endpoint.js";
import { getPushKeyEndpoint } from "./get-push-key/endpoint.js";
import { listDevicesEndpoint } from "./list-devices/endpoint.js";
import { removeDeviceEndpoint } from "./remove-device/endpoint.js";
import { testDeviceEndpoint } from "./test-device/endpoint.js";
import { updatePreferencesEndpoint } from "./update-preferences/endpoint.js";

export const notificationsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/notifications/push-key", getPushKeyEndpoint),
  HttpRouter.add("GET", "/api/notifications/devices", listDevicesEndpoint),
  HttpRouter.add("POST", "/api/notifications/devices", addDeviceEndpoint),
  HttpRouter.add("DELETE", "/api/notifications/devices/:deviceId", removeDeviceEndpoint),
  HttpRouter.add("POST", "/api/notifications/devices/:deviceId/test", testDeviceEndpoint),
  HttpRouter.add("GET", "/api/notifications/preferences", getPreferencesEndpoint),
  HttpRouter.add("PUT", "/api/notifications/preferences", updatePreferencesEndpoint),
);
