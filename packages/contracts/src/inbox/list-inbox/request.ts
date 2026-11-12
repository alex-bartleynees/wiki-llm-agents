import { Schema } from "effect";

/** GET /api/inbox takes no input; open and snoozed items, and the latest done or dismissed. */
export const ListInboxRequest = Schema.Struct({});
export type ListInboxRequest = typeof ListInboxRequest.Type;
