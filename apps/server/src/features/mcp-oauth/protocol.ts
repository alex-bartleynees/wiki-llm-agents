import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/*
 * The pure parts of signing in to an MCP server (MCP authorization spec, 2025-06-18
 * and 2025-11-25): reading the server's 401, where its metadata lives, PKCE, and which
 * scopes to ask for. `discovery.ts` does the requests.
 */

/** `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` as a map of its parameters (lowercase names); null when it isn't a Bearer challenge. */
export const bearerChallenge = (header: string | null): ReadonlyMap<string, string> | null => {
  if (header === null) return null;
  const at = header.search(/\bbearer\b/i);
  if (at < 0) return null;
  const params = new Map<string, string>();
  const rest = header.slice(at + "bearer".length);
  for (const match of rest.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!params.has(name)) params.set(name, match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : (match[3] ?? ""));
  }
  return params;
};

/** `/mcp/` → `/mcp`, `/` → ``. */
const trimmedPath = (url: URL) => url.pathname.replace(/\/+$/, "");

/**
 * Where a server's protected-resource metadata may be (RFC 9728): the address its 401
 * named, then the well-known address with the server's path, then without it.
 */
export const protectedResourceUrls = (serverUrl: string, named: string | null): ReadonlyArray<string> => {
  const url = new URL(serverUrl);
  const path = trimmedPath(url);
  const found = [named, path === "" ? null : `${url.origin}/.well-known/oauth-protected-resource${path}`, `${url.origin}/.well-known/oauth-protected-resource`];
  return [...new Set(found.filter((value): value is string => value !== null))];
};

/**
 * Where an authorization server's metadata may be, in the order the MCP spec gives:
 * OAuth (RFC 8414) and OpenID Connect with the issuer's path inserted, then OpenID
 * Connect with it appended (Keycloak's `/realms/<realm>/.well-known/openid-configuration`).
 */
export const authorizationServerUrls = (issuer: string): ReadonlyArray<string> => {
  const url = new URL(issuer);
  const path = trimmedPath(url);
  if (path === "") return [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`];
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
};

const isLoopback = (hostname: string) => {
  const name = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || (isIP(name) === 4 && name.startsWith("127."));
};

/**
 * Why `value` can't be used as an identity server's address, or null. Tokens and codes
 * go only over HTTPS, or plain HTTP to this machine (OAuth 2.1).
 */
export const insecureUrlProblem = (value: unknown, what: string): string | null => {
  if (typeof value !== "string") return `The identity server gave no ${what}.`;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return null;
    if (url.protocol === "http:" && isLoopback(url.hostname)) return null;
    return `The identity server's ${what} (${value}) isn't HTTPS.`;
  } catch {
    return `The identity server's ${what} (${value}) isn't an address.`;
  }
};

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** A PKCE pair (RFC 7636, S256). */
export const pkcePair = () => {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
};

/** An unguessable `state`, tying the identity server's answer to the sign-in that asked. */
export const newState = () => base64url(randomBytes(24));

/**
 * The scopes to ask for: the server file's, else the ones the 401 named, else those the
 * server advertises. `offline_access` is added when the identity server offers it, so
 * the app gets a refresh token (as Netclaw does for the coffee journal).
 */
export const chooseScopes = (input: {
  readonly configured: ReadonlyArray<string>;
  readonly challenged: string | null;
  readonly advertised: ReadonlyArray<string>;
  readonly offered: ReadonlyArray<string>;
}): ReadonlyArray<string> => {
  const fromChallenge = (input.challenged ?? "").split(/\s+/).filter((scope) => scope !== "");
  const base = input.configured.length > 0 ? input.configured : fromChallenge.length > 0 ? fromChallenge : input.advertised;
  const scopes = [...new Set(base)];
  if (input.offered.includes("offline_access") && !scopes.includes("offline_access")) scopes.push("offline_access");
  return scopes;
};

/** The identity server's sign-in page for this attempt. */
export const authorizationUrl = (input: {
  readonly endpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
  readonly scopes: ReadonlyArray<string>;
  readonly resource: string;
}): string => {
  const url = new URL(input.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.scopes.length > 0) url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("resource", input.resource);
  return url.toString();
};

/**
 * Whether the protected-resource metadata's `resource` may stand for the server at
 * `serverUrl`: the same origin, and the server's path within it.
 */
export const resourceMatches = (resource: string, serverUrl: string): boolean => {
  try {
    const claimed = new URL(resource);
    const server = new URL(serverUrl);
    const path = trimmedPath(claimed);
    return claimed.origin === server.origin && (path === "" || trimmedPath(server) === path || trimmedPath(server).startsWith(`${path}/`));
  } catch {
    return false;
  }
};
