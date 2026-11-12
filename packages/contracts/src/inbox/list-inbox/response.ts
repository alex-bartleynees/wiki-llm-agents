import { Schema } from "effect";
import { InboxItem } from "../model.js";

export const ListInboxResponse = Schema.Struct({
  /** Newest first: every open item (snoozed ones too), then up to 50 done or dismissed. */
  items: Schema.Array(InboxItem),
});
export type ListInboxResponse = typeof ListInboxResponse.Type;
