import { Schema } from "effect";
import { PushDevice } from "../model.js";

export const AddDeviceResponse = Schema.Struct({ device: PushDevice });
export type AddDeviceResponse = typeof AddDeviceResponse.Type;
