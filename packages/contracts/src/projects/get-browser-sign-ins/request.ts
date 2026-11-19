import { Schema } from "effect";

/** GET /api/projects/:projectId/browser-sign-ins */
export const GetBrowserSignInsRequest = Schema.Struct({});
export type GetBrowserSignInsRequest = typeof GetBrowserSignInsRequest.Type;
