import { Schema } from "effect";

/** The turn the message started; its events arrive on the thread's stream. */
export const SendMessageResponse = Schema.Struct({
  turnId: Schema.String,
});
export type SendMessageResponse = typeof SendMessageResponse.Type;
