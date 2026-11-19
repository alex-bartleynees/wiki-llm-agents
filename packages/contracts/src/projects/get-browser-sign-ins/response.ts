import { Schema } from "effect";
import { BrowserSignIn } from "../model.js";

/** The project's browser sign-ins, in the order you listed them. Secret names only, never values. */
export const GetBrowserSignInsResponse = Schema.Struct({
  signIns: Schema.Array(BrowserSignIn),
});
export type GetBrowserSignInsResponse = typeof GetBrowserSignInsResponse.Type;
