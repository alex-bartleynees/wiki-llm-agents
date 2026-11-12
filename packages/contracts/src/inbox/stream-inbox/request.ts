import { Schema } from "effect";

/** GET /events/inbox takes no input; `InboxStreamMessage`s. */
export const StreamInboxRequest = Schema.Struct({});
export type StreamInboxRequest = typeof StreamInboxRequest.Type;
