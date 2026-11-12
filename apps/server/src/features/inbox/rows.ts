import { randomUUID } from "node:crypto";
import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { asc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { NewInboxItem } from "./repository.js";
import { inboxDeliveries, inboxItems } from "./table.js";

/**
 * Reading and writing inbox rows inside a transaction, shared by the inbox's adapter
 * and the schedules adapter, which adds a reminder's item in the same transaction
 * as its occurrence.
 */

type Db = Pick<BetterSQLite3Database, "select" | "insert" | "update">;
type ItemRow = typeof inboxItems.$inferSelect;
type DeliveryRow = typeof inboxDeliveries.$inferSelect;

/** Adds the item and queues it on each channel; returns its id. */
export const insertInboxItem = (db: Db, item: NewInboxItem, channels: ReadonlyArray<string>, at: number) => {
  const id = randomUUID();
  const when = new Date(at);
  db.insert(inboxItems)
    .values({
      id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      state: "open",
      read: false,
      overdue: item.overdue ?? false,
      vaultId: item.source.vaultId ?? null,
      threadId: item.source.threadId ?? null,
      turnId: item.source.turnId ?? null,
      requestId: item.source.requestId ?? null,
      scheduleId: item.source.scheduleId ?? null,
      notePath: item.source.notePath ?? null,
      createdAt: when,
      updatedAt: when,
    })
    .run();
  queueDeliveries(db, id, channels, at);
  return id;
};

/** Queues (again) the item's delivery on each channel at `at`. */
export const queueDeliveries = (db: Db, itemId: string, channels: ReadonlyArray<string>, at: number) => {
  for (const channel of channels) {
    const queued = { status: "queued" as const, attempts: 0, nextAttemptAt: new Date(at), lastError: null, detail: null, sentAt: null };
    db.insert(inboxDeliveries)
      .values({ itemId, channel, ...queued })
      .onConflictDoUpdate({ target: [inboxDeliveries.itemId, inboxDeliveries.channel], set: queued })
      .run();
  }
};

const toItem = (row: ItemRow, deliveries: ReadonlyArray<DeliveryRow>): InboxItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  state: row.state,
  read: row.read,
  overdue: row.overdue,
  snoozedUntil: row.snoozedUntil?.getTime() ?? null,
  resolution: row.resolution,
  source: {
    vaultId: row.vaultId,
    threadId: row.threadId,
    turnId: row.turnId,
    requestId: row.requestId,
    scheduleId: row.scheduleId,
    notePath: row.notePath,
  },
  deliveries: deliveries.map((delivery) => ({
    channel: delivery.channel,
    status: delivery.status,
    attempts: delivery.attempts,
    lastError: delivery.lastError,
    detail: delivery.detail,
    sentAt: delivery.sentAt?.getTime() ?? null,
  })),
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

/** The rows as items, with their deliveries, in the same order. */
export const toInboxItems = (db: Db, rows: ReadonlyArray<ItemRow>): ReadonlyArray<InboxItem> => {
  if (rows.length === 0) return [];
  const deliveries = db
    .select()
    .from(inboxDeliveries)
    .where(inArray(inboxDeliveries.itemId, rows.map((row) => row.id)))
    .orderBy(asc(inboxDeliveries.channel))
    .all();
  return rows.map((row) => toItem(row, deliveries.filter((delivery) => delivery.itemId === row.id)));
};

export const readInboxItem = (db: Db, itemId: string): InboxItem | undefined => {
  const row = db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).get();
  return row === undefined ? undefined : toInboxItems(db, [row])[0];
};
