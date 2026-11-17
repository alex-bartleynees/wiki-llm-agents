import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An MCP server behind an identity server on 127.0.0.1, standing in for the coffee
 * journal and its Keycloak: the MCP endpoint answers 401 pointing to its metadata, the
 * sign-in page sends the browser straight back with a code (no login), and the token
 * endpoint checks PKCE. The server tests have a fuller one; the two apps don't share code.
 */
export interface StandInIdentity {
  readonly mcpUrl: string;
  /** Query parameters of each visit to the sign-in page. */
  readonly authorizations: Array<Record<string, string>>;
  readonly close: () => Promise<void>;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

export const startStandInIdentity = async (): Promise<StandInIdentity> => {
  const codes = new Map<string, { challenge: string; scope: string }>();
  const authorizations: Array<Record<string, string>> = [];
  let base = "";
  const realm = "/realms/e2e";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", base);
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(JSON.stringify(body));
      };
      switch (url.pathname) {
        case "/mcp":
          return send(401, {}, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
        case "/.well-known/oauth-protected-resource/mcp":
          return send(200, { resource: `${base}/mcp`, authorization_servers: [`${base}${realm}`] });
        case `${realm}/.well-known/openid-configuration`:
          return send(200, {
            issuer: `${base}${realm}`,
            authorization_endpoint: `${base}${realm}/auth`,
            token_endpoint: `${base}${realm}/token`,
            scopes_supported: ["openid", "offline_access", "journal:read"],
            code_challenge_methods_supported: ["S256"],
          });
        case `${realm}/auth`: {
          const params = Object.fromEntries(url.searchParams);
          authorizations.push(params);
          const code = `code-${authorizations.length}`;
          codes.set(code, { challenge: params["code_challenge"] ?? "", scope: params["scope"] ?? "" });
          const back = new URL(params["redirect_uri"] ?? "");
          back.searchParams.set("code", code);
          back.searchParams.set("state", params["state"] ?? "");
          response.writeHead(302, { location: back.toString() });
          return response.end();
        }
        case `${realm}/token`: {
          const form = new URLSearchParams(await readBody(request));
          const code = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          if (code === undefined || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== code.challenge) {
            return send(400, { error: "invalid_grant" });
          }
          return send(200, { access_token: `access-${authorizations.length}`, token_type: "Bearer", expires_in: 300, refresh_token: "refresh", scope: code.scope });
        }
        default:
          return send(404, {});
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { mcpUrl: `${base}/mcp`, authorizations, close: () => new Promise((resolve) => server.close(() => resolve())) };
};
