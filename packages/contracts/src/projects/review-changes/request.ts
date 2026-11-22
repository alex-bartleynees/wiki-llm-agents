import { Schema } from "effect";

export const ReviewChangesRequest = Schema.Struct({ projectId: Schema.String });
export type ReviewChangesRequest = typeof ReviewChangesRequest.Type;
