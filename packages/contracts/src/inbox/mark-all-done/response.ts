import { Schema } from "effect";
import { InboxItem } from "../model.js";

export const MarkAllDoneResponse = Schema.Struct({ items: Schema.Array(InboxItem) });
export type MarkAllDoneResponse = typeof MarkAllDoneResponse.Type;
