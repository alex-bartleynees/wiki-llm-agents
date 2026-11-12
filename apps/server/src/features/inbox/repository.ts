import type { InboxItem, InboxItemKind, InboxItemState, InboxSource } from "@wiki-agents/contracts/inbox/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

/** An item to add; its deliveries are queued on every channel in the same transaction. */
export interface NewInboxItem {
  readonly kind: InboxItemKind;
  readonly title: string;
  readonly body: string;
  readonly overdue?: boolean;
  readonly source: Partial<InboxSource>;
}

/** A delivery due now: the item on one channel, and how many times it was tried. */
export interface DueDelivery {
  readonly itemId: string;
  readonly channel: string;
  readonly attempts: number;
}

/**
 * Inbox items and their delivery outbox. Items are added with their deliveries
 * queued, in one transaction; the delivery worker sends them.
 */
export interface InboxRepositoryService {
  /** Open items (snoozed too), newest first, then the latest done or dismissed. */
  readonly list: Effect.Effect<ReadonlyArray<InboxItem>, DbError>;
  readonly find: (itemId: string) => Effect.Effect<Option.Option<InboxItem>, DbError>;
  readonly add: (item: NewInboxItem, channels: ReadonlyArray<string>, at: number) => Effect.Effect<InboxItem, DbError>;
  /** The items that were unread. */
  readonly markRead: (itemIds: ReadonlyArray<string>, at: number) => Effect.Effect<ReadonlyArray<InboxItem>, DbError>;
  /** Hides the item until `until`, unread, and queues its delivery again for then. */
  readonly snooze: (itemId: string, until: number, channels: ReadonlyArray<string>, at: number) => Effect.Effect<Option.Option<InboxItem>, DbError>;
  readonly setState: (
    itemId: string,
    state: InboxItemState,
    at: number,
    resolution?: string,
  ) => Effect.Effect<Option.Option<InboxItem>, DbError>;
  /** The open item for an approval or question. */
  readonly findOpenRequest: (requestId: string) => Effect.Effect<Option.Option<InboxItem>, DbError>;
  /** Request ids of the open request items. */
  readonly openRequestIds: Effect.Effect<ReadonlyArray<string>, DbError>;
  /**
   * The thread's latest turn result: replaces its open `turn.finished`/`turn.failed`
   * item (unread again, delivered again) or adds one.
   */
  readonly putTurnItem: (threadId: string, item: NewInboxItem, channels: ReadonlyArray<string>, at: number) => Effect.Effect<InboxItem, DbError>;
  /** Marks the thread's open turn items done (you went back to it); the ones that changed. */
  readonly closeTurnItems: (threadId: string, at: number) => Effect.Effect<ReadonlyArray<InboxItem>, DbError>;
  readonly dueDeliveries: (now: number) => Effect.Effect<ReadonlyArray<DueDelivery>, DbError>;
  /** When the next queued delivery is due; null when none is queued. */
  readonly nextDeliveryAt: Effect.Effect<number | null, DbError>;
  /** The item as it will be delivered: a snooze that is over is cleared first. */
  readonly beginDelivery: (itemId: string, at: number) => Effect.Effect<Option.Option<InboxItem>, DbError>;
  readonly deliverySent: (itemId: string, channel: string, at: number) => Effect.Effect<void, DbError>;
  /** Records the error; queued again at `retryAt`, or failed for good when it is null. */
  readonly deliveryFailed: (itemId: string, channel: string, error: string, retryAt: number | null) => Effect.Effect<void, DbError>;
}

export class InboxRepository extends Context.Service<InboxRepository, InboxRepositoryService>()("InboxRepository") {}
