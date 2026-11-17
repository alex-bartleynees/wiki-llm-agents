import { Schema } from "effect";

export const StartConnectResponse = Schema.Struct({
  /** The identity server's sign-in page; open it here or on another device. */
  authorizationUrl: Schema.String,
  /** Where the identity server sends you back to. */
  redirectUri: Schema.String,
  /** The sign-in must be finished before this (ms since the epoch). */
  expiresAt: Schema.Number,
});
export type StartConnectResponse = typeof StartConnectResponse.Type;
