import { Schema } from "effect";
import { InboxItem } from "../model.js";

/** The items that changed. */
export const MarkReadResponse = Schema.Struct({ items: Schema.Array(InboxItem) });
export type MarkReadResponse = typeof MarkReadResponse.Type;
