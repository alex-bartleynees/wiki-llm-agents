import { Schema } from "effect";
import { RequestAnswer } from "../model.js";

/**
 * POST /api/threads/:threadId/requests/:requestId with this body. 404 for an
 * unknown request, 409 when it was already answered or doesn't take this kind of answer.
 */
export const AnswerRequestRequest = Schema.Struct({
  answer: RequestAnswer,
});
export type AnswerRequestRequest = typeof AnswerRequestRequest.Type;
