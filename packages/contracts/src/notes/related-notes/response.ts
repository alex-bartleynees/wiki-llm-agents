import { Schema } from "effect";
export const RelatedNotesResponse = Schema.Struct({ notes: Schema.Array(Schema.Struct({ path: Schema.String, title: Schema.String, score: Schema.Number, reasons: Schema.Array(Schema.String) })) });
