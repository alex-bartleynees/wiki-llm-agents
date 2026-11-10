import { NoteReference } from "../context.js";
import { Schema } from "effect";

/** POST /api/threads/:threadId/messages with this body. 409 while a turn is running. */
export const SendMessageRequest = Schema.Struct({
  text: Schema.String.check(Schema.isNonEmpty()),
  notes: Schema.optionalKey(Schema.Array(NoteReference).check(Schema.isMaxLength(10))),
});
export type SendMessageRequest = typeof SendMessageRequest.Type;
