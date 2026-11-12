import { Schema } from "effect";
import { NotificationPreferences } from "../model.js";

export const UpdatePreferencesResponse = Schema.Struct({ preferences: NotificationPreferences });
export type UpdatePreferencesResponse = typeof UpdatePreferencesResponse.Type;
