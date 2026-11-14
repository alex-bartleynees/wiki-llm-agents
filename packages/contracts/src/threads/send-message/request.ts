import { MAX_ATTACHMENTS } from "../../attachments/model.js";
import { NoteReference } from "../context.js";
import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/messages with this body. 409 while a turn is running.
 * The text may be empty when the message has attachments (400 when it has neither).
 */
export const SendMessageRequest = Schema.Struct({
  text: Schema.String,
  notes: Schema.optionalKey(Schema.Array(NoteReference).check(Schema.isMaxLength(10))),
  /** Ids from `POST /api/attachments`, in the order to show and send them. */
  attachments: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_ATTACHMENTS))),
});
export type SendMessageRequest = typeof SendMessageRequest.Type;
