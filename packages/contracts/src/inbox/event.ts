import { Schema } from "effect";
import { InboxItem } from "./model.js";

/** Sent first, once the server is subscribed. */
export const InboxStreamReady = Schema.Struct({ type: Schema.Literal("ready") });

/** An item arrived (or came back from snooze), or changed. */
export const InboxItemUpdated = Schema.Struct({ type: Schema.Literal("item.updated"), item: InboxItem });

/** Events on GET /events/inbox. No replay: reload the list after a reconnect. */
export const InboxStreamMessage = Schema.Union([InboxStreamReady, InboxItemUpdated]);
export type InboxStreamMessage = typeof InboxStreamMessage.Type;
