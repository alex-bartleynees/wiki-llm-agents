import { Schema } from "effect";
import { PushDevice } from "../model.js";

/**
 * - `sent`: the push service accepted it (not proof the device showed it)
 * - `failed`: it didn't (`error` says why); the device stays
 * - `expired`: the subscription is gone, so the device was removed (`device` is null)
 */
export const TestDeviceResponse = Schema.Struct({
  status: Schema.Literals(["sent", "failed", "expired"]),
  error: Schema.NullOr(Schema.String),
  device: Schema.NullOr(PushDevice),
});
export type TestDeviceResponse = typeof TestDeviceResponse.Type;
