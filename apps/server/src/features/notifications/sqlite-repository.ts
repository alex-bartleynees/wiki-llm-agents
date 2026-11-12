import { randomUUID } from "node:crypto";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferences,
  type PushDevice,
} from "@wiki-agents/contracts/notifications/model";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { insertInboxItem, readInboxItem } from "../inbox/rows.js";
import { MAX_DEVICE_FAILURES, NotificationsRepository, type DeviceWithTarget } from "./repository.js";
import { notificationSettings, pushDeliveries, pushDevices, pushDigestQueue } from "./table.js";

const SETTINGS_ID = "default";

type DeviceRow = typeof pushDevices.$inferSelect;

const serviceOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

const toDevice = (row: DeviceRow): PushDevice => ({
  id: row.id,
  name: row.name,
  service: serviceOf(row.endpoint),
  createdAt: row.createdAt.getTime(),
  lastSentAt: row.lastSentAt?.getTime() ?? null,
  lastError: row.lastError,
  failures: row.failures,
  disabled: row.disabled,
});

const withTarget = (row: DeviceRow): DeviceWithTarget => ({
  device: toDevice(row),
  target: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
});

const PreferencesJson = Schema.fromJsonString(NotificationPreferences);
const decodePreferences = Schema.decodeUnknownResult(PreferencesJson);
const encodePreferences = Schema.encodeSync(PreferencesJson);

export const NotificationsRepositoryLive = Layer.effect(
  NotificationsRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    const deviceRow = (deviceId: string) => db.select().from(pushDevices).where(eq(pushDevices.id, deviceId)).get();

    /** Records the item's delivery to the device (one row per item and device). */
    const recordItem = (itemId: string | null, deviceId: string, status: "sent" | "failed" | "expired", error: string | null, at: number) => {
      if (itemId === null) return;
      const values = { status, lastError: error, at: new Date(at) };
      db.insert(pushDeliveries)
        .values({ itemId, deviceId, attempts: 1, ...values })
        .onConflictDoUpdate({
          target: [pushDeliveries.itemId, pushDeliveries.deviceId],
          set: { ...values, attempts: sql`${pushDeliveries.attempts} + 1` },
        })
        .run();
    };

    const ensureSettings = () => db.insert(notificationSettings).values({ id: SETTINGS_ID }).onConflictDoNothing().run();

    return NotificationsRepository.of({
      preferences: query(() => {
        const row = db.select().from(notificationSettings).where(eq(notificationSettings.id, SETTINGS_ID)).get();
        if (row?.preferences == null) return DEFAULT_NOTIFICATION_PREFERENCES;
        const decoded = decodePreferences(row.preferences);
        return decoded._tag === "Success" ? decoded.success : DEFAULT_NOTIFICATION_PREFERENCES;
      }),

      savePreferences: (preferences) =>
        query(() => {
          ensureSettings();
          db.update(notificationSettings)
            .set({ preferences: encodePreferences(preferences) })
            .where(eq(notificationSettings.id, SETTINGS_ID))
            .run();
        }),

      vapidKeys: (make) =>
        query(() =>
          db.transaction((tx) => {
            tx.insert(notificationSettings).values({ id: SETTINGS_ID }).onConflictDoNothing().run();
            const row = tx.select().from(notificationSettings).where(eq(notificationSettings.id, SETTINGS_ID)).get();
            if (row?.vapidPublicKey != null && row.vapidPrivateKey != null) {
              return { publicKey: row.vapidPublicKey, privateKey: row.vapidPrivateKey };
            }
            const keys = make();
            tx.update(notificationSettings)
              .set({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey })
              .where(eq(notificationSettings.id, SETTINGS_ID))
              .run();
            return keys;
          }),
        ),

      devices: query(() => db.select().from(pushDevices).orderBy(desc(pushDevices.createdAt)).all().map(toDevice)),

      activeDevices: query(() =>
        db.select().from(pushDevices).where(eq(pushDevices.disabled, false)).orderBy(asc(pushDevices.createdAt)).all().map(withTarget),
      ),

      findDevice: (deviceId) => query(() => Option.map(Option.fromNullishOr(deviceRow(deviceId)), withTarget)),

      putDevice: (device, at) =>
        query(() => {
          const keys = { p256dh: device.p256dh, auth: device.auth, name: device.name };
          db.insert(pushDevices)
            .values({
              id: randomUUID(),
              endpoint: device.endpoint,
              ...keys,
              createdAt: new Date(at),
              lastSentAt: null,
              lastError: null,
              failures: 0,
              disabled: false,
            })
            .onConflictDoUpdate({ target: pushDevices.endpoint, set: { ...keys, failures: 0, disabled: false, lastError: null } })
            .run();
          return toDevice(db.select().from(pushDevices).where(eq(pushDevices.endpoint, device.endpoint)).get()!);
        }),

      removeDevice: (deviceId) =>
        query(() =>
          db.transaction((tx) => {
            tx.delete(pushDeliveries).where(eq(pushDeliveries.deviceId, deviceId)).run();
            return tx.delete(pushDevices).where(eq(pushDevices.id, deviceId)).run().changes > 0;
          }),
        ),

      pushSent: (deviceId, itemId, at) =>
        query(() =>
          db.transaction(() => {
            db.update(pushDevices).set({ lastSentAt: new Date(at), lastError: null, failures: 0, disabled: false }).where(eq(pushDevices.id, deviceId)).run();
            recordItem(itemId, deviceId, "sent", null, at);
          }),
        ),

      pushFailed: (deviceId, itemId, error, at) =>
        query(() =>
          db.transaction(() => {
            db.update(pushDevices)
              .set({
                lastError: error,
                failures: sql`${pushDevices.failures} + 1`,
                disabled: sql`${pushDevices.failures} + 1 >= ${MAX_DEVICE_FAILURES}`,
              })
              .where(eq(pushDevices.id, deviceId))
              .run();
            recordItem(itemId, deviceId, "failed", error, at);
            return Option.map(Option.fromNullishOr(deviceRow(deviceId)), toDevice);
          }),
        ),

      pushExpired: (deviceId, itemId, at) =>
        query(() =>
          db.transaction(() => {
            db.delete(pushDeliveries).where(eq(pushDeliveries.deviceId, deviceId)).run();
            db.delete(pushDevices).where(eq(pushDevices.id, deviceId)).run();
            recordItem(itemId, deviceId, "expired", "The subscription has expired; the device was removed.", at);
          }),
        ),

      sentTo: (itemId) =>
        query(
          () =>
            new Set(
              db
                .select({ deviceId: pushDeliveries.deviceId })
                .from(pushDeliveries)
                .where(and(eq(pushDeliveries.itemId, itemId), eq(pushDeliveries.status, "sent")))
                .all()
                .map((row) => row.deviceId),
            ),
        ),

      resetItem: (itemId) => query(() => void db.delete(pushDeliveries).where(eq(pushDeliveries.itemId, itemId)).run()),

      holdForDigest: (itemId, at) =>
        query(() => void db.insert(pushDigestQueue).values({ itemId, heldAt: new Date(at) }).onConflictDoNothing().run()),

      oldestHeldAt: query(() => {
        const row = db.get<{ at: number | null }>(sql`SELECT MIN(held_at) AS at FROM push_digest_queue`);
        return row?.at ?? null;
      }),

      takeDigest: (before, digest, channels, at) =>
        query(() =>
          db.transaction((tx) => {
            const held = tx
              .select()
              .from(pushDigestQueue)
              .where(lt(pushDigestQueue.heldAt, new Date(before)))
              .orderBy(asc(pushDigestQueue.heldAt))
              .all();
            if (held.length === 0) return Option.none<string>();
            tx.delete(pushDigestQueue).where(lt(pushDigestQueue.heldAt, new Date(before))).run();
            const open = held.flatMap((row) => {
              const item = readInboxItem(tx, row.itemId);
              return item !== undefined && item.state === "open" ? [{ kind: item.kind, title: item.title }] : [];
            });
            if (open.length === 0) return Option.none<string>();
            return Option.some(insertInboxItem(tx, digest(open), channels, at));
          }),
        ),
    });
  }),
);
