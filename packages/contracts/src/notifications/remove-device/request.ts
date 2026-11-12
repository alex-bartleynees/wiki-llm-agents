import { Schema } from "effect";

/** DELETE /api/notifications/devices/:deviceId: stops notifications to the device. */
export const RemoveDeviceParams = Schema.Struct({ deviceId: Schema.String });
export type RemoveDeviceParams = typeof RemoveDeviceParams.Type;
