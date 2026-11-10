import { Schema } from "effect";

/** PUT /api/threads/:threadId/model with this body. Applies from the next turn. */
export const SetModelRequest = Schema.Struct({
  model: Schema.String.check(Schema.isNonEmpty()),
});
export type SetModelRequest = typeof SetModelRequest.Type;
