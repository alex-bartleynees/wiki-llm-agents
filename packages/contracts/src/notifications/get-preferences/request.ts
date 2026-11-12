import { Schema } from "effect";

/** Takes no input. */
export const GetPreferencesRequest = Schema.Struct({});
export type GetPreferencesRequest = typeof GetPreferencesRequest.Type;
