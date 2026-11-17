import type { McpConnection } from "@wiki-agents/contracts/mcp-oauth/model";
import { Context, Data, type Effect } from "effect";
import type { McpServerNotFound } from "../mcp-servers/catalog.js";
import type { SecretStoreUnavailable } from "../secrets/secret-store.js";

/** A step of signing in failed; `reason` is for the user and never holds a token or code. */
export class SignInFailed extends Data.TaggedError("SignInFailed")<{ readonly reason: string }> {}

/** The identity server said a code or refresh token is no good (`invalid_grant`). */
export class GrantRejected extends Data.TaggedError("GrantRejected")<{ readonly reason: string }> {}

/** No sign-in is waiting for this answer: never started, already used, or too old. */
export class SignInUnknown extends Data.TaggedError("SignInUnknown")<{ readonly reason: string }> {}

/** The server has no usable sign-in: connect (again) in Settings. */
export class SignInNeeded extends Data.TaggedError("SignInNeeded")<{ readonly serverId: string; readonly reason: string }> {}

/** The identity server's answer to the sign-in page: a code, or why not. */
export interface SignInAnswer {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  readonly errorDescription: string | null;
}

/**
 * Sign-ins to MCP servers that ask for OAuth. Settings starts and finishes them; the
 * connection pool asks for the `Authorization` header, renewed when it has run out.
 */
export interface McpConnectionsService {
  /** One per server that can sign in (HTTP, without its own `Authorization` header). */
  readonly list: Effect.Effect<ReadonlyArray<McpConnection>>;
  /**
   * The sign-in page for `serverId`, coming back to `origin` (the address the app is
   * browsed at); finish with `finish` within `expiresAt`.
   */
  readonly start: (
    serverId: string,
    origin: string,
  ) => Effect.Effect<{ readonly authorizationUrl: string; readonly redirectUri: string; readonly expiresAt: number }, McpServerNotFound | SignInFailed | SecretStoreUnavailable>;
  /** Exchanges the identity server's code and keeps the tokens. */
  readonly finish: (answer: SignInAnswer) => Effect.Effect<McpConnection, SignInUnknown | SignInFailed | GrantRejected | SecretStoreUnavailable>;
  /** Forgets the tokens (a registered client is kept). */
  readonly disconnect: (serverId: string) => Effect.Effect<McpConnection, McpServerNotFound | SecretStoreUnavailable>;
  /** `Bearer <token>` for requests to the server, renewing it first when it has run out or nearly. */
  readonly authorization: (serverId: string) => Effect.Effect<string, SignInNeeded | McpServerNotFound>;
}

export class McpConnections extends Context.Service<McpConnections, McpConnectionsService>()("McpConnections") {}
