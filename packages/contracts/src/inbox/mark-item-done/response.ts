import { Schema } from "effect";
import { InboxItem } from "../model.js";

export const MarkItemDoneResponse = Schema.Struct({ item: InboxItem });
export type MarkItemDoneResponse = typeof MarkItemDoneResponse.Type;
