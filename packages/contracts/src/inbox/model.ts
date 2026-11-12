import { Schema } from "effect";

/**
 * One inbox across agents, vaults and projects.
 * - `reminder`: a reminder arrived
 * - `prompt.result`: a scheduled prompt's answer (markdown)
 * - `prompt.failed`: a scheduled prompt's run failed (`body` says why)
 * - `prompt.missed`: a scheduled prompt's time passed while the app was off, and it didn't run
 * - `request`: an approval or question is waiting for you
 * - `turn.finished`, `turn.failed`: a thread's turn ended (the latest one per thread)
 */
export const InboxItemKind = Schema.Literals([
  "reminder",
  "prompt.result",
  "prompt.failed",
  "prompt.missed",
  "request",
  "turn.finished",
  "turn.failed",
]);
export type InboxItemKind = typeof InboxItemKind.Type;

/**
 * - `open`: in the inbox
 * - `done`: you marked it done, or it resolved itself (its request was answered)
 * - `dismissed`: you dismissed it
 */
export const InboxItemState = Schema.Literals(["open", "done", "dismissed"]);
export type InboxItemState = typeof InboxItemState.Type;

/** Where the item came from; links to each that is set. */
export const InboxSource = Schema.Struct({
  vaultId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  requestId: Schema.NullOr(Schema.String),
  scheduleId: Schema.NullOr(Schema.String),
  /** A note in `vaultId`. */
  notePath: Schema.NullOr(Schema.String),
});
export type InboxSource = typeof InboxSource.Type;

/**
 * Getting an item to you over one channel: `in-app` is the open browsers (live
 * updates). Retried a few times, then `failed` with the error.
 */
export const Delivery = Schema.Struct({
  channel: Schema.String,
  status: Schema.Literals(["queued", "sent", "failed"]),
  attempts: Schema.Number,
  lastError: Schema.NullOr(Schema.String),
  sentAt: Schema.NullOr(Schema.Number),
});
export type Delivery = typeof Delivery.Type;

export const InboxItem = Schema.Struct({
  id: Schema.String,
  kind: InboxItemKind,
  title: Schema.String,
  /** Plain text, or markdown for `prompt.result`. */
  body: Schema.String,
  state: InboxItemState,
  read: Schema.Boolean,
  /** Arrived late: the app was off or asleep when it was due. */
  overdue: Schema.Boolean,
  /** Hidden until then; it comes back unread. Null when not snoozed. */
  snoozedUntil: Schema.NullOr(Schema.Number),
  /** How a request resolved ("Approved", "Cancelled"...), once it has. */
  resolution: Schema.NullOr(Schema.String),
  source: InboxSource,
  /** The latest delivery on each channel. */
  deliveries: Schema.Array(Delivery),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type InboxItem = typeof InboxItem.Type;

/** Counts toward the header's badge: open, unread and not snoozed. */
export const isUnread = (item: InboxItem) => item.state === "open" && !item.read && item.snoozedUntil === null;

export const INBOX_PATH = "/inbox";
