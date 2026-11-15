import { Schema } from "effect";

export const GetDraftRequest = Schema.Struct({ threadId: Schema.String });
export type GetDraftRequest = typeof GetDraftRequest.Type;
