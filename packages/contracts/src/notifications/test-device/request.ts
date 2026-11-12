import { Schema } from "effect";

/** POST /api/notifications/devices/:deviceId/test: sends a test notification now. */
export const TestDeviceParams = Schema.Struct({ deviceId: Schema.String });
export type TestDeviceParams = typeof TestDeviceParams.Type;
