import { Effect, Result, Schema } from "effect";
import { networkReason } from "../../shared/network-reason.js";
import { GrantRejected, SignInFailed } from "./connections.js";
import { authorizationServerUrls, bearerChallenge, insecureUrlProblem, protectedResourceUrls, resourceMatches } from "./protocol.js";
import type { ClientAuth, StoredClient } from "./stored.js";

/*
 * The requests a sign-in makes: asking the MCP server how to sign in, reading the
 * identity server's metadata, registering a client, and the token endpoint. Every
 * failure is a `SignInFailed` whose reason names the step and never carries a token.
 */

const TIMEOUT_MS = 15_000;
/** Metadata and token answers are small; anything bigger isn't one. */
const MAX_BODY_BYTES = 256 * 1024;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const send = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) }),
    catch: (cause) => new SignInFailed({ reason: `Can't reach ${hostOf(url)}: ${networkReason(cause)}` }),
  });

/** The body as JSON, or undefined when it isn't (or is too big). */
const jsonBody = (response: Response) =>
  Effect.promise(async () => {
    try {
      const text = await response.text();
      return text.length > MAX_BODY_BYTES ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  });

const discard = (response: Response) => Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());

const Strings = Schema.Array(Schema.String);

const ProtectedResource = Schema.Struct({
  resource: Schema.optionalKey(Schema.String),
  authorization_servers: Schema.optionalKey(Strings),
  scopes_supported: Schema.optionalKey(Strings),
});

const AuthorizationServer = Schema.Struct({
  issuer: Schema.optionalKey(Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optionalKey(Schema.String),
  scopes_supported: Schema.optionalKey(Strings),
  code_challenge_methods_supported: Schema.optionalKey(Strings),
  token_endpoint_auth_methods_supported: Schema.optionalKey(Strings),
});

const decodeResource = Schema.decodeUnknownResult(ProtectedResource);
const decodeServer = Schema.decodeUnknownResult(AuthorizationServer);

/** The first address that answers 200 with JSON that decodes, or null. */
const firstMetadata = <A>(urls: ReadonlyArray<string>, decode: (value: unknown) => Result.Result<A, unknown>) =>
  Effect.gen(function* () {
    for (const url of urls) {
      const response = yield* send(url, { headers: { accept: "application/json" } }).pipe(Effect.result);
      if (Result.isFailure(response)) continue;
      if (!response.success.ok) {
        yield* discard(response.success);
        continue;
      }
      const decoded = decode(yield* jsonBody(response.success));
      if (Result.isSuccess(decoded)) return { url, metadata: decoded.success };
    }
    return null;
  });

/** What the MCP server and its identity server say about signing in. */
export interface Discovered {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | null;
  /** The resource indicator: the server's own address, or the one its metadata gives. */
  readonly resource: string;
  /** Scopes the 401 named. */
  readonly challenged: string | null;
  /** Scopes the MCP server advertises. */
  readonly advertised: ReadonlyArray<string>;
  /** Scopes the identity server offers. */
  readonly offered: ReadonlyArray<string>;
  readonly tokenAuthMethods: ReadonlyArray<string> | null;
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wiki-agents", version: "1" } },
});

/**
 * Asks the MCP server at `serverUrl` how to sign in: an unauthenticated `initialize`
 * whose 401 points to its protected-resource metadata, which names its identity server,
 * whose metadata gives the endpoints. A server that publishes no metadata but answers
 * 401 is taken to be its own identity server (the 2025-03-26 spec).
 */
export const discover = (serverUrl: string) =>
  Effect.gen(function* () {
    const probe = yield* send(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: INITIALIZE,
    });
    yield* discard(probe);
    const challenge = probe.status === 401 || probe.status === 403 ? bearerChallenge(probe.headers.get("www-authenticate")) : null;
    const asked = probe.status === 401;

    const resource = yield* firstMetadata(protectedResourceUrls(serverUrl, challenge?.get("resource_metadata") ?? null), decodeResource);
    if (resource === null && !asked) {
      return yield* new SignInFailed({ reason: `${hostOf(serverUrl)} didn't ask to sign in (it answered ${probe.status}), and publishes no sign-in details.` });
    }
    const named = resource?.metadata.resource;
    if (named !== undefined && !resourceMatches(named, serverUrl)) {
      return yield* new SignInFailed({ reason: `The server's sign-in details are for ${named}, not ${serverUrl}.` });
    }
    const issuer = resource === null ? new URL(serverUrl).origin : resource.metadata.authorization_servers?.[0];
    if (issuer === undefined) return yield* new SignInFailed({ reason: `${hostOf(serverUrl)} names no identity server to sign in with.` });
    const issuerProblem = insecureUrlProblem(issuer, "address");
    if (issuerProblem !== null) return yield* new SignInFailed({ reason: issuerProblem });

    const server = yield* firstMetadata(authorizationServerUrls(issuer), decodeServer);
    if (server === null) return yield* new SignInFailed({ reason: `The identity server ${issuer} publishes no OAuth details.` });
    const metadata = server.metadata;
    for (const [value, what] of [
      [metadata.authorization_endpoint, "sign-in page"],
      [metadata.token_endpoint, "token endpoint"],
      ...(metadata.registration_endpoint === undefined ? [] : [[metadata.registration_endpoint, "registration endpoint"] as const]),
    ] as const) {
      const problem = insecureUrlProblem(value, what);
      if (problem !== null) return yield* new SignInFailed({ reason: problem });
    }
    if (metadata.code_challenge_methods_supported !== undefined && !metadata.code_challenge_methods_supported.includes("S256")) {
      return yield* new SignInFailed({ reason: `The identity server ${issuer} doesn't support PKCE with S256, which the app requires.` });
    }
    return {
      issuer: metadata.issuer ?? issuer,
      authorizationEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      registrationEndpoint: metadata.registration_endpoint ?? null,
      resource: named ?? serverUrl,
      challenged: challenge?.get("scope") ?? null,
      advertised: resource?.metadata.scopes_supported ?? [],
      offered: metadata.scopes_supported ?? [],
      tokenAuthMethods: metadata.token_endpoint_auth_methods_supported ?? null,
    } satisfies Discovered;
  });

const Registration = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optionalKey(Schema.String),
  token_endpoint_auth_method: Schema.optionalKey(Schema.String),
});
const decodeRegistration = Schema.decodeUnknownResult(Registration);

const AUTH_METHODS: ReadonlyArray<ClientAuth> = ["none", "client_secret_basic", "client_secret_post"];

/** Registers this app as a public client at the identity server (RFC 7591), for servers whose file names no client id. */
export const registerClient = (input: { readonly endpoint: string; readonly redirectUri: string; readonly scopes: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const response = yield* send(input.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Wiki agents",
        redirect_uris: [input.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(input.scopes.length === 0 ? {} : { scope: input.scopes.join(" ") }),
      }),
    });
    const body = yield* jsonBody(response);
    if (!response.ok) return yield* new SignInFailed({ reason: `The identity server refused to register the app (${response.status}${oauthError(body)}).` });
    const decoded = decodeRegistration(body);
    if (Result.isFailure(decoded)) return yield* new SignInFailed({ reason: "The identity server's registration answer has no client id." });
    const secret = decoded.success.client_secret ?? null;
    const method = decoded.success.token_endpoint_auth_method as ClientAuth | undefined;
    const auth: ClientAuth = method !== undefined && AUTH_METHODS.includes(method) ? method : secret === null ? "none" : "client_secret_basic";
    return { clientId: decoded.success.client_id, clientSecret: secret, auth, registered: true, redirectUri: input.redirectUri } satisfies StoredClient;
  });

/** ` : invalid_grant: Token is not active`, from an OAuth error body; empty for anything else. */
const oauthError = (body: unknown) => {
  if (typeof body !== "object" || body === null) return "";
  const { error, error_description: description } = body as { error?: unknown; error_description?: unknown };
  if (typeof error !== "string") return "";
  return typeof description === "string" && description !== "" ? `: ${error}: ${description.slice(0, 200)}` : `: ${error}`;
};

const TokenResponse = Schema.Struct({
  access_token: Schema.String.check(Schema.isNonEmpty()),
  token_type: Schema.String,
  expires_in: Schema.optionalKey(Schema.Union([Schema.Number, Schema.NumberFromString])),
  refresh_token: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
});
const decodeTokens = Schema.decodeUnknownResult(TokenResponse);

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Seconds the access token lasts, if said. */
  readonly expiresIn: number | null;
  readonly scope: string | null;
}

/** A token endpoint request with the client's authentication (RFC 6749 §2.3). */
export const tokenRequest = (endpoint: string, client: StoredClient, params: Record<string, string>) =>
  Effect.gen(function* () {
    const body = new URLSearchParams(params);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (client.auth === "client_secret_basic" && client.clientSecret !== null) {
      headers["authorization"] = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}`;
    } else {
      body.set("client_id", client.clientId);
      if (client.auth === "client_secret_post" && client.clientSecret !== null) body.set("client_secret", client.clientSecret);
    }
    const response = yield* send(endpoint, { method: "POST", headers, body });
    const answer = yield* jsonBody(response);
    if (!response.ok) {
      const reason = `The identity server refused (${response.status}${oauthError(answer)}).`;
      const rejected = typeof answer === "object" && answer !== null && (answer as { error?: unknown }).error === "invalid_grant";
      return yield* rejected ? new GrantRejected({ reason }) : new SignInFailed({ reason });
    }
    const decoded = decodeTokens(answer);
    if (Result.isFailure(decoded)) return yield* new SignInFailed({ reason: "The identity server's answer has no access token." });
    if (decoded.success.token_type.toLowerCase() !== "bearer") return yield* new SignInFailed({ reason: `The identity server gave a ${decoded.success.token_type} token; the app uses Bearer tokens.` });
    const expiresIn = decoded.success.expires_in;
    return {
      accessToken: decoded.success.access_token,
      refreshToken: decoded.success.refresh_token ?? null,
      expiresIn: expiresIn !== undefined && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null,
      scope: decoded.success.scope ?? null,
    } satisfies Tokens;
  });
