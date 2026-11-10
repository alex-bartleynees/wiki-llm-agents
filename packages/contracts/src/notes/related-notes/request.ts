import { Schema } from "effect";
export const RelatedNotesRequest = Schema.Struct({ path: Schema.String.check(Schema.isNonEmpty()) });
