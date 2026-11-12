import { Schema } from "effect";

/** POST /api/inbox/:itemId/done: dealt with. */
export const MarkItemDoneRequest = Schema.Struct({ itemId: Schema.String });
export type MarkItemDoneRequest = typeof MarkItemDoneRequest.Type;
