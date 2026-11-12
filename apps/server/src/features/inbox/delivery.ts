import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { Context, Data, Effect, Layer } from "effect";
import { InboxBus, type InboxBusService } from "./inbox-bus.js";

export class DeliveryFailed extends Data.TaggedError("DeliveryFailed")<{ readonly message: string }> {}

/**
 * A way of getting an inbox item to you. Each item is queued on every channel in the
 * delivery outbox and sent by the delivery worker, which retries a few times.
 */
export interface DeliveryChannel {
  readonly id: string;
  readonly deliver: (item: InboxItem) => Effect.Effect<void, DeliveryFailed>;
}

export class DeliveryChannels extends Context.Service<DeliveryChannels, ReadonlyArray<DeliveryChannel>>()("DeliveryChannels") {}

/** The open browsers: the item goes out on the inbox's live stream. */
export const inAppChannel = (bus: InboxBusService): DeliveryChannel => ({
  id: "in-app",
  deliver: (item) => bus.publish([item]),
});

export const DeliveryChannelsLive = Layer.effect(
  DeliveryChannels,
  Effect.gen(function* () {
    return [inAppChannel(yield* InboxBus)];
  }),
);
