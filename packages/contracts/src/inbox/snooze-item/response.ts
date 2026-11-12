import { Schema } from "effect";
import { InboxItem } from "../model.js";

export const SnoozeItemResponse = Schema.Struct({ item: InboxItem });
export type SnoozeItemResponse = typeof SnoozeItemResponse.Type;
