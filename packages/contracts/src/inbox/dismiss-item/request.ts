import { Schema } from "effect";

/** POST /api/inbox/:itemId/dismiss: out of the inbox, kept in its history. */
export const DismissItemRequest = Schema.Struct({ itemId: Schema.String });
export type DismissItemRequest = typeof DismissItemRequest.Type;
