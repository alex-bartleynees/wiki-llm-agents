import { Schema } from "effect";
import { NotificationPreferences } from "../model.js";

/** GET /api/notifications/preferences, and the answer to PUT. */
export const GetPreferencesResponse = Schema.Struct({ preferences: NotificationPreferences });
export type GetPreferencesResponse = typeof GetPreferencesResponse.Type;
