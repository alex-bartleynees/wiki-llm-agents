import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Everything waiting for you, across agents, vaults and projects. */
export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["reminder", "prompt.result", "prompt.failed", "prompt.missed", "request", "turn.finished", "turn.failed"],
    }).notNull(),
    title: text("title").notNull(),
    /** Markdown. */
    body: text("body").notNull(),
    state: text("state", { enum: ["open", "done", "dismissed"] }).notNull(),
    read: integer("read", { mode: "boolean" }).notNull(),
    overdue: integer("overdue", { mode: "boolean" }).notNull(),
    snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
    /** How a request was resolved, e.g. "Approved". */
    resolution: text("resolution"),
    vaultId: text("vault_id"),
    threadId: text("thread_id"),
    turnId: text("turn_id"),
    requestId: text("request_id"),
    scheduleId: text("schedule_id"),
    notePath: text("note_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("inbox_items_state_idx").on(table.state, table.updatedAt),
    index("inbox_items_request_idx").on(table.requestId),
    index("inbox_items_thread_idx").on(table.threadId, table.kind),
  ],
);

/**
 * The delivery outbox: each item on each channel, queued in the same transaction as
 * the item, retried a bounded number of times, failures kept and shown.
 */
export const inboxDeliveries = sqliteTable(
  "inbox_deliveries",
  {
    itemId: text("item_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status", { enum: ["queued", "sent", "failed"] }).notNull(),
    attempts: integer("attempts").notNull(),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
    lastError: text("last_error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.channel] }), index("inbox_deliveries_due_idx").on(table.status, table.nextAttemptAt)],
);
