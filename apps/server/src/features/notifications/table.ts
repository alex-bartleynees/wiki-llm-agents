import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Browsers that get notifications: one Web Push subscription each. */
export const pushDevices = sqliteTable(
  "push_devices",
  {
    id: text("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    /** The subscription's keys (base64url), which payloads are encrypted for. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    /** Failures in a row; the device is disabled at five. */
    failures: integer("failures").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).notNull(),
  },
  (table) => [uniqueIndex("push_devices_endpoint_idx").on(table.endpoint)],
);

/**
 * Each inbox item on each device, so a retried delivery only goes to the devices
 * that didn't get it. Cleared when the item is queued again (a snooze ended).
 */
export const pushDeliveries = sqliteTable(
  "push_deliveries",
  {
    itemId: text("item_id").notNull(),
    deviceId: text("device_id").notNull(),
    /** `expired`: the push service said the subscription is gone, and the device was removed. */
    status: text("status", { enum: ["sent", "failed", "expired"] }).notNull(),
    attempts: integer("attempts").notNull(),
    lastError: text("last_error"),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.deviceId] }), index("push_deliveries_device_idx").on(table.deviceId)],
);

/** Inbox items held for the next morning digest. */
export const pushDigestQueue = sqliteTable("push_digest_queue", {
  itemId: text("item_id").primaryKey(),
  heldAt: integer("held_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * One row of settings: the preferences (`NotificationPreferences` as JSON) and the
 * VAPID keys made on first start, unless they come from a secrets file.
 */
export const notificationSettings = sqliteTable("notification_settings", {
  id: text("id").primaryKey(),
  preferences: text("preferences"),
  vapidPublicKey: text("vapid_public_key"),
  vapidPrivateKey: text("vapid_private_key"),
});
