import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeMcpHandler } from "./stand-in-mcp.js";

/**
 * An MCP server behind an identity server, on 127.0.0.1, standing in for the coffee
 * journal and Keycloak (no real Keycloak in the suite). The MCP endpoint answers 401
 * pointing to its protected-resource metadata; the identity server publishes its
 * metadata at Keycloak's realm address, issues codes from its sign-in page at once
 * (no login), checks PKCE, and issues tokens that a refresh rotates.
 */
export interface StandInOptions {
  /** Offer dynamic client registration (Jira); off for Keycloak as configured. */
  readonly registration?: boolean;
  /** Answer signed-in requests to the MCP endpoint as an MCP server (`stand-in-mcp.ts`) instead of with an empty result. */
  readonly mcp?: boolean;
  /** Seconds an access token lasts. */
  readonly expiresIn?: number;
}

interface Code {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly scope: string;
  readonly resource: string | null;
}

export interface StandInIdentity {
  readonly base: string;
  /** The MCP server's address. */
  readonly mcpUrl: string;
  readonly issuer: string;
  /** Query parameters of each visit to the sign-in page. */
  readonly authorizations: Array<Record<string, string>>;
  /** Form fields of each token request. */
  readonly tokenRequests: Array<Record<string, string>>;
  readonly registrations: Array<Record<string, unknown>>;
  /** Access tokens the MCP server would accept now. */
  readonly validTokens: Set<string>;
  /** What the MCP endpoint was sent once signed in (with `mcp: true`). */
  readonly mcpRequests: ReadonlyArray<{ readonly method: string; readonly authorization: string | null }>;
  /** Makes every refresh token stop working (a revoked sign-in). */
  readonly revokeRefreshTokens: () => void;
  /** Makes the token endpoint fail with 503 until called with false. */
  readonly breakTokenEndpoint: (broken: boolean) => void;
  readonly close: () => Promise<void>;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

export const startStandInIdentity = async (options: StandInOptions = {}): Promise<StandInIdentity> => {
  const codes = new Map<string, Code>();
  const refreshTokens = new Map<string, { clientId: string; scope: string }>();
  const authorizations: Array<Record<string, string>> = [];
  const tokenRequests: Array<Record<string, string>> = [];
  const registrations: Array<Record<string, unknown>> = [];
  const validTokens = new Set<string>();
  let issued = 0;
  let broken = false;
  let base = "";
  const realm = "/realms/test";
  const mcp = options.mcp === true ? makeMcpHandler() : null;

  const issue = (clientId: string, scope: string) => {
    issued += 1;
    const access = `access-${issued}`;
    validTokens.add(access);
    const offline = scope.split(" ").includes("offline_access");
    const refresh = offline ? `refresh-${issued}` : undefined;
    if (refresh !== undefined) refreshTokens.set(refresh, { clientId, scope });
    return { access_token: access, token_type: "Bearer", expires_in: options.expiresIn ?? 300, scope, ...(refresh === undefined ? {} : { refresh_token: refresh }) };
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", base);
      const path = url.pathname;
      if (path === "/mcp") {
        const token = request.headers.authorization?.replace(/^Bearer /, "");
        if (token !== undefined && validTokens.has(token)) return mcp === null ? json(response, 200, { jsonrpc: "2.0", id: 1, result: {} }) : mcp.handle(request, response);
        return json(response, 401, { error: "unauthorized" }, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="journal:read"`,
        });
      }
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [`${base}${realm}`], scopes_supported: ["journal:read"] });
      }
      // Only Keycloak's own metadata address answers, so the client has to try the others first.
      if (path === `${realm}/.well-known/openid-configuration`) {
        return json(response, 200, {
          issuer: `${base}${realm}`,
          authorization_endpoint: `${base}${realm}/auth`,
          token_endpoint: `${base}${realm}/token`,
          ...(options.registration === true ? { registration_endpoint: `${base}${realm}/register` } : {}),
          scopes_supported: ["openid", "offline_access", "journal:read"],
          code_challenge_methods_supported: ["plain", "S256"],
        });
      }
      if (path === `${realm}/auth`) {
        const params = Object.fromEntries(url.searchParams);
        authorizations.push(params);
        const back = new URL(params["redirect_uri"] ?? "");
        if (params["state"] !== undefined) back.searchParams.set("state", params["state"]);
        if (params["prompt"] === "deny") {
          back.searchParams.set("error", "access_denied");
          back.searchParams.set("error_description", "You said no.");
        } else {
          const code = `code-${authorizations.length}`;
          codes.set(code, {
            clientId: params["client_id"] ?? "",
            redirectUri: params["redirect_uri"] ?? "",
            challenge: params["code_challenge"] ?? "",
            scope: params["scope"] ?? "",
            resource: params["resource"] ?? null,
          });
          back.searchParams.set("code", code);
        }
        response.writeHead(302, { location: back.toString() });
        return response.end();
      }
      if (path === `${realm}/register` && request.method === "POST") {
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        registrations.push(body);
        return json(response, 201, { client_id: `registered-${registrations.length}`, ...body });
      }
      if (path === `${realm}/token` && request.method === "POST") {
        const form = Object.fromEntries(new URLSearchParams(await readBody(request)));
        tokenRequests.push(form);
        if (broken) return json(response, 503, { error: "temporarily_unavailable" });
        const reject = () => json(response, 400, { error: "invalid_grant", error_description: "Token is not active" });
        if (form["grant_type"] === "authorization_code") {
          const code = codes.get(form["code"] ?? "");
          codes.delete(form["code"] ?? "");
          const verified = code !== undefined && createHash("sha256").update(form["code_verifier"] ?? "").digest("base64url") === code.challenge;
          if (code === undefined || !verified || code.clientId !== form["client_id"] || code.redirectUri !== form["redirect_uri"] || code.resource !== (form["resource"] ?? null)) return reject();
          return json(response, 200, issue(code.clientId, code.scope));
        }
        if (form["grant_type"] === "refresh_token") {
          const known = refreshTokens.get(form["refresh_token"] ?? "");
          if (known === undefined || known.clientId !== form["client_id"]) return reject();
          refreshTokens.delete(form["refresh_token"] ?? "");
          return json(response, 200, issue(known.clientId, known.scope));
        }
        return json(response, 400, { error: "unsupported_grant_type" });
      }
      json(response, 404, { error: "not_found" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    mcpUrl: `${base}/mcp`,
    issuer: `${base}${realm}`,
    authorizations,
    tokenRequests,
    registrations,
    validTokens,
    mcpRequests: mcp?.requests ?? [],
    revokeRefreshTokens: () => refreshTokens.clear(),
    breakTokenEndpoint: (value) => (broken = value),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};
