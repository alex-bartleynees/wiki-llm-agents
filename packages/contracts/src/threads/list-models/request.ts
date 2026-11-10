import { Schema } from "effect";

/** GET /api/threads/:threadId/models. Empty when the provider has no model choice. */
export const ListModelsRequest = Schema.Struct({
  threadId: Schema.String,
});
export type ListModelsRequest = typeof ListModelsRequest.Type;
