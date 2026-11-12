import { Schema } from "effect";

export const SnoozeItemParams = Schema.Struct({ itemId: Schema.String });
export type SnoozeItemParams = typeof SnoozeItemParams.Type;

/** POST /api/inbox/:itemId/snooze: hides the item until `until` (ms since the epoch, in the future); it comes back unread. */
export const SnoozeItemRequest = Schema.Struct({ until: Schema.Number.check(Schema.isInt()) });
export type SnoozeItemRequest = typeof SnoozeItemRequest.Type;
