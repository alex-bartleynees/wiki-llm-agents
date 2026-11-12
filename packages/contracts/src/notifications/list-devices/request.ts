import { Schema } from "effect";

/** Takes no input. */
export const ListDevicesRequest = Schema.Struct({});
export type ListDevicesRequest = typeof ListDevicesRequest.Type;
