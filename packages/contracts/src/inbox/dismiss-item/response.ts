import { Schema } from "effect";
import { InboxItem } from "../model.js";

export const DismissItemResponse = Schema.Struct({ item: InboxItem });
export type DismissItemResponse = typeof DismissItemResponse.Type;
