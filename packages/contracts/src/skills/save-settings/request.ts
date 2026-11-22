import { Schema } from "effect";
import { Destination, NullableHash } from "../model.js";

export const SaveSettingsRequest = Schema.Struct({ library: Schema.String, destinations: Schema.Array(Destination), baseHash: NullableHash });
export type SaveSettingsRequest = typeof SaveSettingsRequest.Type;
