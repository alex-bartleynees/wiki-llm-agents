import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { Context, Effect, Layer, PubSub, type Scope } from "effect";

/** Inbox items as they arrive or change, for the inbox's SSE connections. Written to SQLite first. */
export interface InboxBusService {
  readonly publish: (items: ReadonlyArray<InboxItem>) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<PubSub.Subscription<InboxItem>, never, Scope.Scope>;
}

export class InboxBus extends Context.Service<InboxBus, InboxBusService>()("InboxBus") {}

export const InboxBusLive = Layer.effect(
  InboxBus,
  Effect.gen(function* () {
    const items = yield* PubSub.unbounded<InboxItem>();
    return InboxBus.of({
      publish: (changed) => Effect.asVoid(PubSub.publishAll(items, changed)),
      subscribe: PubSub.subscribe(items),
    });
  }),
);
