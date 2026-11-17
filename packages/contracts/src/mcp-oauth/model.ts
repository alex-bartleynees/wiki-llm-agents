import { Schema } from "effect";

/**
 * Signing in to MCP servers that ask for OAuth (an identity server such as Keycloak in
 * front of the coffee journal): Connect in Settings opens the identity server's page,
 * which sends you back to the app; the app keeps the tokens encrypted with the secrets
 * and renews them. No response ever carries a token.
 */

/**
 * - `connected`: signed in; the app has a token, or can renew it
 * - `expired`: the token ran out and can't be renewed; connect again
 * - `disconnected`: never signed in, or signed out
 * - `changed`: the server's address or client id changed since signing in; connect again
 * - `unreadable`: the stored sign-in can't be read (the secrets' key is missing)
 */
export const McpConnectionState = Schema.Literals(["connected", "expired", "disconnected", "changed", "unreadable"]);
export type McpConnectionState = typeof McpConnectionState.Type;

export const McpConnection = Schema.Struct({
  serverId: Schema.String,
  state: McpConnectionState,
  /** When you signed in (ms since the epoch). */
  connectedAt: Schema.NullOr(Schema.Number),
  /** When the current access token stops working; null when the identity server didn't say. */
  expiresAt: Schema.NullOr(Schema.Number),
  /** Whether the app renews the token itself (it was given a refresh token). */
  renews: Schema.Boolean,
  /** The scopes granted. */
  scopes: Schema.Array(Schema.String),
  /** The identity server signed in to. */
  issuer: Schema.NullOr(Schema.String),
  /** Why the last renewal or sign-in failed, or why the state is what it is. */
  problem: Schema.NullOr(Schema.String),
});
export type McpConnection = typeof McpConnection.Type;

/** The path the identity server sends you back to, after the origin the app is browsed at. */
export const OAUTH_CALLBACK_PATH = "/api/mcp-servers/oauth/callback";

/** Query parameters on the Settings page after the callback: which server signed in, or why not. */
export const CONNECTED_PARAM = "mcp-connected";
export const CONNECT_FAILED_PARAM = "mcp-connect-failed";
