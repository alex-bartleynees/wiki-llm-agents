import { Schema } from "effect";

/** POST /api/threads/:threadId/messages with this body. 409 while a turn is running. */
export const SendMessageRequest = Schema.Struct({
  text: Schema.String.check(Schema.isNonEmpty()),
});
export type SendMessageRequest = typeof SendMessageRequest.Type;
