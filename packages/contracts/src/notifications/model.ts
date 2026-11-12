import { Schema } from "effect";
import { LocalTime } from "../schedules/model.js";

/**
 * Notifications on your devices with the app closed (Web Push). Each browser that
 * turns them on is a device with its own push subscription; inbox items go to every
 * device, as your preferences say.
 */

/**
 * A browser that gets notifications. A push service that says the subscription is
 * gone (404, 410) removes the device; five failures in a row disable it until it
 * subscribes again.
 */
export const PushDevice = Schema.Struct({
  id: Schema.String,
  /** "Chrome on Android", say; from the browser that subscribed. */
  name: Schema.String,
  /** The push service's host, e.g. fcm.googleapis.com. */
  service: Schema.String,
  createdAt: Schema.Number,
  lastSentAt: Schema.NullOr(Schema.Number),
  /** The last failure, cleared by the next success. */
  lastError: Schema.NullOr(Schema.String),
  /** Failures in a row. */
  failures: Schema.Number,
  disabled: Schema.Boolean,
});
export type PushDevice = typeof PushDevice.Type;

/**
 * What happens to an inbox item on your devices:
 * - `immediate`: a notification now
 * - `digest`: listed in the morning digest instead
 * - `off`: in the inbox only
 */
export const PushRoute = Schema.Literals(["immediate", "digest", "off"]);
export type PushRoute = typeof PushRoute.Type;

/**
 * The groups of inbox items with a route each:
 * - `reminders`: reminders, and scheduled prompts that were missed
 * - `requests`: an agent waiting for your approval or answer
 * - `results`: scheduled prompts' answers and failures
 * - `turns`: a thread's turn finished or failed
 */
export const PushRoutes = Schema.Struct({
  reminders: PushRoute,
  requests: PushRoute,
  results: PushRoute,
  turns: PushRoute,
});
export type PushRoutes = typeof PushRoutes.Type;

export const NotificationPreferences = Schema.Struct({
  /** Muted: nothing goes to your devices (the inbox keeps everything). */
  muted: Schema.Boolean,
  /** Notifications say only what kind of item arrived, never its text. */
  privatePreviews: Schema.Boolean,
  routes: PushRoutes,
  /** When the morning digest goes out, local time in the server's timezone. */
  digestTime: LocalTime,
});
export type NotificationPreferences = typeof NotificationPreferences.Type;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  muted: false,
  privatePreviews: false,
  routes: { reminders: "immediate", requests: "immediate", results: "immediate", turns: "off" },
  digestTime: "08:00",
};

/**
 * What a notification carries (encrypted for the device). The service worker shows
 * `title` and `body`, and opens `url` when you tap it. `tag` is the inbox item, so a
 * newer notification for it replaces the older one.
 */
export const PushPayload = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  tag: Schema.String,
});
export type PushPayload = typeof PushPayload.Type;

export const NOTIFICATIONS_PATH = "/inbox/notifications";
