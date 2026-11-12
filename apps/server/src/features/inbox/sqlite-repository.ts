import { and, asc, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { InboxRepository } from "./repository.js";
import { insertInboxItem, queueDeliveries, readInboxItem, toInboxItems } from "./rows.js";
import { inboxDeliveries, inboxItems } from "./table.js";

/** Done and dismissed items listed after the open ones. */
const HISTORY = 50;

const TURN_KINDS = ["turn.finished", "turn.failed"] as const;

export const InboxRepositoryLive = Layer.effect(
  InboxRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    const read = (itemId: string) => Option.fromNullishOr(readInboxItem(db, itemId));

    return InboxRepository.of({
      list: query(() => {
        const open = db.select().from(inboxItems).where(eq(inboxItems.state, "open")).orderBy(desc(inboxItems.updatedAt)).all();
        const closed = db
          .select()
          .from(inboxItems)
          .where(ne(inboxItems.state, "open"))
          .orderBy(desc(inboxItems.updatedAt))
          .limit(HISTORY)
          .all();
        return toInboxItems(db, [...open, ...closed]);
      }),

      find: (itemId) => query(() => read(itemId)),

      add: (item, channels, at) =>
        query(() => {
          const id = db.transaction((tx) => insertInboxItem(tx, item, channels, at));
          return Option.getOrThrow(read(id));
        }),

      markRead: (itemIds, at) =>
        query(() => {
          if (itemIds.length === 0) return [];
          const unread = and(inArray(inboxItems.id, [...itemIds]), eq(inboxItems.read, false));
          const changed = db.select({ id: inboxItems.id }).from(inboxItems).where(unread).all();
          if (changed.length === 0) return [];
          db.update(inboxItems).set({ read: true, updatedAt: new Date(at) }).where(unread).run();
          const rows = db.select().from(inboxItems).where(inArray(inboxItems.id, changed.map((row) => row.id))).all();
          return toInboxItems(db, rows);
        }),

      snooze: (itemId, until, channels, at) =>
        query(() =>
          db.transaction((tx) => {
            const updated = tx
              .update(inboxItems)
              .set({ snoozedUntil: new Date(until), read: false, state: "open", updatedAt: new Date(at) })
              .where(eq(inboxItems.id, itemId))
              .run();
            if (updated.changes === 0) return Option.none();
            queueDeliveries(tx, itemId, channels, until);
            return Option.fromNullishOr(readInboxItem(tx, itemId));
          }),
        ),

      setState: (itemId, state, at, resolution) =>
        query(() => {
          db.update(inboxItems)
            .set({ state, snoozedUntil: null, updatedAt: new Date(at), ...(resolution === undefined ? {} : { resolution }) })
            .where(eq(inboxItems.id, itemId))
            .run();
          return read(itemId);
        }),

      findOpenRequest: (requestId) =>
        query(() => {
          const row = db
            .select({ id: inboxItems.id })
            .from(inboxItems)
            .where(and(eq(inboxItems.requestId, requestId), eq(inboxItems.state, "open")))
            .get();
          return row === undefined ? Option.none() : read(row.id);
        }),

      openRequestIds: query(() =>
        db
          .select({ requestId: inboxItems.requestId })
          .from(inboxItems)
          .where(and(eq(inboxItems.kind, "request"), eq(inboxItems.state, "open"), isNotNull(inboxItems.requestId)))
          .all()
          .map((row) => row.requestId!),
      ),

      putTurnItem: (threadId, item, channels, at) =>
        query(() => {
          const id = db.transaction((tx) => {
            const existing = tx
              .select({ id: inboxItems.id })
              .from(inboxItems)
              .where(and(eq(inboxItems.threadId, threadId), inArray(inboxItems.kind, [...TURN_KINDS]), eq(inboxItems.state, "open")))
              .get();
            if (existing === undefined) return insertInboxItem(tx, item, channels, at);
            tx.update(inboxItems)
              .set({
                kind: item.kind,
                title: item.title,
                body: item.body,
                read: false,
                snoozedUntil: null,
                turnId: item.source.turnId ?? null,
                updatedAt: new Date(at),
              })
              .where(eq(inboxItems.id, existing.id))
              .run();
            queueDeliveries(tx, existing.id, channels, at);
            return existing.id;
          });
          return Option.getOrThrow(read(id));
        }),

      closeTurnItems: (threadId, at) =>
        query(() => {
          const open = and(eq(inboxItems.threadId, threadId), inArray(inboxItems.kind, [...TURN_KINDS]), eq(inboxItems.state, "open"));
          const ids = db.select({ id: inboxItems.id }).from(inboxItems).where(open).all().map((row) => row.id);
          if (ids.length === 0) return [];
          db.update(inboxItems).set({ state: "done", snoozedUntil: null, updatedAt: new Date(at) }).where(inArray(inboxItems.id, ids)).run();
          return toInboxItems(db, db.select().from(inboxItems).where(inArray(inboxItems.id, ids)).all());
        }),

      dueDeliveries: (now) =>
        query(() =>
          db
            .select({ itemId: inboxDeliveries.itemId, channel: inboxDeliveries.channel, attempts: inboxDeliveries.attempts })
            .from(inboxDeliveries)
            .where(and(eq(inboxDeliveries.status, "queued"), lte(inboxDeliveries.nextAttemptAt, new Date(now))))
            .orderBy(asc(inboxDeliveries.nextAttemptAt))
            .all(),
        ),

      nextDeliveryAt: query(() => {
        const row = db.get<{ at: number | null }>(sql`SELECT MIN(next_attempt_at) AS at FROM inbox_deliveries WHERE status = 'queued'`);
        return row?.at ?? null;
      }),

      beginDelivery: (itemId, at) =>
        query(() => {
          db.update(inboxItems)
            .set({ snoozedUntil: null, updatedAt: new Date(at) })
            .where(and(eq(inboxItems.id, itemId), lte(inboxItems.snoozedUntil, new Date(at))))
            .run();
          return read(itemId);
        }),

      deliverySent: (itemId, channel, at) =>
        query(() => {
          db.update(inboxDeliveries)
            .set({ status: "sent", sentAt: new Date(at), attempts: sql`${inboxDeliveries.attempts} + 1`, lastError: null })
            .where(and(eq(inboxDeliveries.itemId, itemId), eq(inboxDeliveries.channel, channel)))
            .run();
        }),

      deliveryFailed: (itemId, channel, error, retryAt) =>
        query(() => {
          db.update(inboxDeliveries)
            .set({
              status: retryAt === null ? "failed" : "queued",
              attempts: sql`${inboxDeliveries.attempts} + 1`,
              lastError: error,
              ...(retryAt === null ? {} : { nextAttemptAt: new Date(retryAt) }),
            })
            .where(and(eq(inboxDeliveries.itemId, itemId), eq(inboxDeliveries.channel, channel)))
            .run();
        }),
    });
  }),
);
