import { Schema } from "effect";

/** GET /api/changes/:changeId: one change in full, for its whole diff or the three-way view. */
export const GetChangeRequest = Schema.Struct({ changeId: Schema.String });
export type GetChangeRequest = typeof GetChangeRequest.Type;
