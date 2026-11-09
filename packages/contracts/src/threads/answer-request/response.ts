import { Schema } from "effect";

export const AnswerRequestResponse = Schema.Struct({
  requestId: Schema.String,
});
export type AnswerRequestResponse = typeof AnswerRequestResponse.Type;
