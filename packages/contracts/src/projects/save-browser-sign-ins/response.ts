import { GetBrowserSignInsResponse } from "../get-browser-sign-ins/response.js";

/** The list as saved: names trimmed, sites as origins (`http://localhost:3000`). */
export const SaveBrowserSignInsResponse = GetBrowserSignInsResponse;
export type SaveBrowserSignInsResponse = typeof SaveBrowserSignInsResponse.Type;
