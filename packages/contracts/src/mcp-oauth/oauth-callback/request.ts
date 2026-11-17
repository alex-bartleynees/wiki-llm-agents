import { Schema } from "effect";

/**
 * GET /api/mcp-servers/oauth/callback: where the identity server sends the browser
 * back. Answers with a redirect to Settings, with `CONNECTED_PARAM` or
 * `CONNECT_FAILED_PARAM` in the query.
 */
export const OAuthCallbackRequest = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  error_description: Schema.optionalKey(Schema.String),
});
export type OAuthCallbackRequest = typeof OAuthCallbackRequest.Type;
