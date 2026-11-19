import { Schema } from "effect";
import { BrowserSignIn } from "../model.js";

/**
 * PUT /api/projects/:projectId/browser-sign-ins with this body: the whole list, which
 * replaces the project's. 400 with the problems (`browserSignInProblems`) when it can't
 * be saved. Threads get the new list from their next turn.
 */
export const SaveBrowserSignInsRequest = Schema.Struct({
  signIns: Schema.Array(BrowserSignIn),
});
export type SaveBrowserSignInsRequest = typeof SaveBrowserSignInsRequest.Type;
