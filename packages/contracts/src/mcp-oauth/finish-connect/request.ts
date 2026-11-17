import { Schema } from "effect";

/**
 * POST /api/mcp-servers/oauth/finish: finishes a sign-in from the address the identity
 * server sent you to, pasted, for when that address can't reach the app (signed in on
 * another device, or through a tunnel). 409 with the reason when it doesn't finish one.
 */
export const FinishConnectRequest = Schema.Struct({
  /** The whole address, with its `code` and `state`. */
  url: Schema.String,
});
export type FinishConnectRequest = typeof FinishConnectRequest.Type;
