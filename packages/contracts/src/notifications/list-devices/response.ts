import { Schema } from "effect";
import { PushDevice } from "../model.js";

/** GET /api/notifications/devices: the devices that get notifications, newest first. */
export const ListDevicesResponse = Schema.Struct({ devices: Schema.Array(PushDevice) });
export type ListDevicesResponse = typeof ListDevicesResponse.Type;
