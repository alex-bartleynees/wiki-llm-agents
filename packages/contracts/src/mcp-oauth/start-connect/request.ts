import { Schema } from "effect";

/**
 * POST /api/mcp-servers/:serverId/connect: finds the server's identity server,
 * registers a client there if the server file names none, and returns the page to sign
 * in on. The way back is this request's `Origin` (the address you browse the app at)
 * plus `OAUTH_CALLBACK_PATH`; the identity server must accept it.
 *
 * 409 with the reason when the server doesn't ask for sign-in, or can't be signed in to.
 */
export const StartConnectRequest = Schema.Struct({
  serverId: Schema.String,
});
export type StartConnectRequest = typeof StartConnectRequest.Type;
