import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { Context, Data, Effect } from "effect";
import type { InboxBusService } from "./inbox-bus.js";

export class DeliveryFailed extends Data.TaggedError("DeliveryFailed")<{ readonly message: string }> {}

/**
 * What a channel did with an item: sent it, or chose not to (muted, held for the
 * digest...). `detail` is shown with the delivery: why it skipped, or where it went.
 */
export interface DeliveryOutcome {
  readonly status: "sent" | "skipped";
  readonly detail: string | null;
}

export const sentOutcome: DeliveryOutcome = { status: "sent", detail: null };

/**
 * A way of getting an inbox item to you. Each item is queued on every channel in the
 * delivery outbox and sent by the delivery worker, which retries a few times.
 * `attempts` is how many times this delivery was tried before: 0 the first time
 * after it was queued (or queued again, when a snooze ends).
 */
export interface DeliveryChannel {
  readonly id: string;
  readonly deliver: (item: InboxItem, attempts: number) => Effect.Effect<DeliveryOutcome, DeliveryFailed>;
}

/** The channels every item is queued on; put together in `app/layers.ts`. */
export class DeliveryChannels extends Context.Service<DeliveryChannels, ReadonlyArray<DeliveryChannel>>()("DeliveryChannels") {}

/** The open browsers: the item goes out on the inbox's live stream. */
export const inAppChannel = (bus: InboxBusService): DeliveryChannel => ({
  id: "in-app",
  deliver: (item) => Effect.as(bus.publish([item]), sentOutcome),
});
