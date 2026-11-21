import { Schema } from "effect";

export const DraftInstructionsResponse = Schema.Struct({ instructions: Schema.String.check(Schema.isNonEmpty()) });
export type DraftInstructionsResponse = typeof DraftInstructionsResponse.Type;
