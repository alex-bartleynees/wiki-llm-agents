import { Schema } from "effect";

/** GET /api/threads/:threadId */
export const GetThreadRequest = Schema.Struct({
  threadId: Schema.String,
});
export type GetThreadRequest = typeof GetThreadRequest.Type;
