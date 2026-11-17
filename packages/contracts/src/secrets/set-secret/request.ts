import { Schema } from "effect";

/**
 * PUT /api/secrets/:name with this body: stores the value encrypted, replacing any
 * stored secret of that name. 422 for a bad name or value, 409 when the name is
 * declared in the service's configuration or the store can't be read.
 */
export const SetSecretRequest = Schema.Struct({
  value: Schema.String,
  /** When the token stops working (ms since the epoch), to show in Settings; null if it doesn't or you don't know. */
  expiresAt: Schema.NullOr(Schema.Number),
});
export type SetSecretRequest = typeof SetSecretRequest.Type;
