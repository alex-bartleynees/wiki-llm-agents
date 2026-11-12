import { Schema } from "effect";
import { NotificationPreferences } from "../model.js";

/** PUT /api/notifications/preferences: replaces them. */
export const UpdatePreferencesRequest = Schema.Struct({ preferences: NotificationPreferences });
export type UpdatePreferencesRequest = typeof UpdatePreferencesRequest.Type;
