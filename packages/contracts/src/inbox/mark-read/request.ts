import { Schema } from "effect";

/** POST /api/inbox/read: you have seen these items. */
export const MarkReadRequest = Schema.Struct({ itemIds: Schema.Array(Schema.String).check(Schema.isMaxLength(500)) });
export type MarkReadRequest = typeof MarkReadRequest.Type;
