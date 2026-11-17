import { Option, Result, Schema } from "effect";

/*
 * A server's sign-in as kept in the secrets store (`mcp-oauth:<server id>`), encrypted:
 * where it signed in, the client it used, and the tokens.
 */

/** How the client proves itself at the token endpoint. */
export const ClientAuth = Schema.Literals(["none", "client_secret_basic", "client_secret_post"]);
export type ClientAuth = typeof ClientAuth.Type;

export const StoredClient = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.NullOr(Schema.String),
  auth: ClientAuth,
  /** Registered by the app (dynamic registration), so it can be reused for this redirect only. */
  registered: Schema.Boolean,
  redirectUri: Schema.String,
});
export type StoredClient = typeof StoredClient.Type;

export const StoredTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  /** When the access token stops working (ms since the epoch); null when not said. */
  expiresAt: Schema.NullOr(Schema.Number),
  scopes: Schema.Array(Schema.String),
  connectedAt: Schema.Number,
});
export type StoredTokens = typeof StoredTokens.Type;

export const StoredConnection = Schema.Struct({
  version: Schema.Literal(1),
  /** The server's address when signing in; a different one now means connecting again. */
  serverUrl: Schema.String,
  /** The client id its file named then (null: registered by the app). */
  configuredClientId: Schema.NullOr(Schema.String),
  issuer: Schema.String,
  tokenEndpoint: Schema.String,
  resource: Schema.String,
  client: StoredClient,
  /** Null once signed out; the registered client stays for the next sign-in. */
  tokens: Schema.NullOr(StoredTokens),
  /** Why the last renewal failed. */
  problem: Schema.NullOr(Schema.String),
});
export type StoredConnection = typeof StoredConnection.Type;

const Json = Schema.fromJsonString(StoredConnection);
const decode = Schema.decodeUnknownResult(Json);
const encode = Schema.encodeSync(Json);

export const CREDENTIAL_PREFIX = "mcp-oauth:";
export const credentialKey = (serverId: string) => `${CREDENTIAL_PREFIX}${serverId}`;

/** The stored sign-in, or none when there is none or it doesn't decode (written by a later version, say). */
export const parseStored = (text: string | undefined): Option.Option<StoredConnection> => {
  if (text === undefined) return Option.none();
  const decoded = decode(text);
  return Result.isSuccess(decoded) ? Option.some(decoded.success) : Option.none();
};

export const storedText = (connection: StoredConnection): string => encode(connection);
