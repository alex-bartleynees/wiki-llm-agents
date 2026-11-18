import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { ListConnectionsResponse } from "@wiki-agents/contracts/mcp-oauth/list-connections/response";
import { FinishConnectResponse } from "@wiki-agents/contracts/mcp-oauth/finish-connect/response";
import { StartConnectResponse } from "@wiki-agents/contracts/mcp-oauth/start-connect/response";
import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { ListSecretsResponse } from "@wiki-agents/contracts/secrets/list-secrets/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { afterAll } from "vitest";
import { McpConnections } from "../../src/features/mcp-oauth/connections.js";
import { RENEW_EARLY_MS } from "../../src/features/mcp-oauth/connections-live.js";
import { WallClock } from "../../src/shared/wall-clock.js";
import { makeTestApp, makeTestSecrets } from "./infrastructure/test-app.js";
import { startStandInIdentity } from "./infrastructure/stand-in-identity.js";
import { decode } from "./infrastructure/threads.js";

/** The coffee journal's Keycloak: a fixed client, no registration. */
const keycloak = await startStandInIdentity();
/** Jira's: registers clients itself. */
const atlassian = await startStandInIdentity({ registration: true });
afterAll(async () => {
  await keycloak.close();
  await atlassian.close();
});

let root = "";
const secrets = makeTestSecrets({ onRoot: (dir) => (root = dir) });

const server = (url: string, extra: Partial<McpServerInput> = {}): McpServerInput => ({
  title: "Server",
  transport: { type: "http", url, headers: {} },
  scope: "app",
  default: false,
  access: null,
  oauth: null,
  excludeTools: [],
  ...extra,
});
const COFFEE = server(keycloak.mcpUrl, { title: "Coffee journal", oauth: { clientId: "coffee-journal-ai-agent", scopes: ["journal:read"] } });

const saveServer = (id: string, input: McpServerInput, baseHash: string | null = null) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ server: input, baseHash }))).pipe(
    Effect.tap((response) => (response.status === 200 ? Effect.void : Effect.die(`save ${id}: ${response.status}`))),
  );
const connections = HttpClient.get("/api/mcp-servers/oauth/connections").pipe(Effect.flatMap(decode(ListConnectionsResponse)));
const connectionOf = (id: string) => Effect.map(connections, ({ connections }) => connections.find((connection) => connection.serverId === id));
const connect = (id: string) => HttpClient.execute(HttpClientRequest.post(`/api/mcp-servers/${id}/connect`));
const connectOk = (id: string) => connect(id).pipe(Effect.flatMap(decode(StartConnectResponse)));

/** Visits the sign-in page the way a browser would, and returns where the identity server sends you. */
const signInPage = (authorizationUrl: string, extra: Record<string, string> = {}) =>
  Effect.promise(async () => {
    const url = new URL(authorizationUrl);
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
    const response = await fetch(url, { redirect: "manual" });
    return response.headers.get("location") ?? "";
  });

/** Follows the identity server back to the app's callback; returns the page it then sends you to. */
const callback = (location: string) =>
  Effect.promise(async () => {
    const response = await fetch(location, { redirect: "manual" });
    return { status: response.status, location: decodeURIComponent((response.headers.get("location") ?? "").replaceAll("+", " ")) };
  });

const authorization = (id: string) => Effect.gen(function* () {
  return yield* (yield* McpConnections).authorization(id);
});

layer(makeTestApp({ secrets }))("MCP sign-in", (it) => {
  it.effect("signs in to the coffee journal with its client id, as Netclaw did, and keeps the tokens encrypted", () =>
    Effect.gen(function* () {
      yield* saveServer("coffee", COFFEE);
      expect(yield* connectionOf("coffee")).toMatchObject({ state: "disconnected", connectedAt: null, renews: false });

      const started = yield* connectOk("coffee");
      expect(started.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/mcp-servers\/oauth\/callback$/);
      const asked = Object.fromEntries(new URL(started.authorizationUrl).searchParams);
      expect(started.authorizationUrl.startsWith(`${keycloak.issuer}/auth?`)).toBe(true);
      expect(asked).toMatchObject({
        response_type: "code",
        client_id: "coffee-journal-ai-agent",
        redirect_uri: started.redirectUri,
        code_challenge_method: "S256",
        // offline_access added because Keycloak offers it, for a refresh token.
        scope: "journal:read offline_access",
        resource: keycloak.mcpUrl,
      });

      const back = yield* signInPage(started.authorizationUrl);
      expect(back.startsWith(started.redirectUri)).toBe(true);
      expect(yield* callback(back)).toEqual({ status: 303, location: "/settings?mcp-connected=coffee" });
      expect(keycloak.tokenRequests.at(-1)).toMatchObject({ grant_type: "authorization_code", client_id: "coffee-journal-ai-agent", resource: keycloak.mcpUrl });
      expect(keycloak.tokenRequests.at(-1)?.["code_verifier"]).toMatch(/^[\w-]{43}$/);

      expect(yield* connectionOf("coffee")).toMatchObject({ state: "connected", renews: true, scopes: ["journal:read", "offline_access"], issuer: keycloak.issuer, problem: null });
      const header = yield* authorization("coffee");
      expect(keycloak.validTokens.has(header.replace("Bearer ", ""))).toBe(true);

      // Encrypted on disk, and never one of the secrets Settings lists.
      const onDisk = readFileSync(join(root, "data", "secrets.enc"), "utf8");
      expect(onDisk).not.toMatch(/access-|refresh-|coffee-journal-ai-agent/);
      expect(JSON.parse(onDisk).credentials).toHaveProperty(["mcp-oauth:coffee"]);
      const listed = yield* HttpClient.get("/api/secrets").pipe(Effect.flatMap(decode(ListSecretsResponse)));
      expect(listed.secrets).toEqual([]);
      expect(listed.store.state).toBe("ready");

      // The same answer can't be used twice.
      expect((yield* callback(back)).location).toMatch(/^\/settings\?mcp-connect-failed=This isn't a sign-in the app is waiting for/);
    }),
  );

  it.effect("renews a token that has run out, keeps it while the identity server is down, and asks to connect again once revoked", () =>
    Effect.gen(function* () {
      const clock = yield* WallClock;
      const first = yield* authorization("coffee");
      // Within a minute of running out: renewed, and the refresh token rotated.
      yield* clock.advance(300_000 - RENEW_EARLY_MS + 1);
      const renewed = yield* authorization("coffee");
      expect(renewed).not.toBe(first);
      expect(keycloak.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", client_id: "coffee-journal-ai-agent", resource: keycloak.mcpUrl });
      expect(yield* authorization("coffee")).toBe(renewed);

      // Down while the token still works: use it, and say why renewing failed.
      yield* clock.advance(300_000 - RENEW_EARLY_MS + 1);
      keycloak.breakTokenEndpoint(true);
      expect(yield* authorization("coffee")).toBe(renewed);
      expect((yield* connectionOf("coffee"))?.problem).toMatch(/Renewing the sign-in to Coffee journal failed: The identity server refused \(503: temporarily_unavailable\)/);
      // Down once it has run out: no header, and the refresh token is kept for later.
      yield* clock.advance(RENEW_EARLY_MS);
      expect((yield* authorization("coffee").pipe(Effect.flip))._tag).toBe("SignInNeeded");
      keycloak.breakTokenEndpoint(false);
      const after = yield* authorization("coffee");
      expect(after).not.toBe(renewed);
      expect((yield* connectionOf("coffee"))?.problem).toBeNull();

      // Revoked at the identity server: connect again.
      keycloak.revokeRefreshTokens();
      yield* clock.advance(300_000);
      const refused = yield* authorization("coffee").pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "SignInNeeded", reason: expect.stringMatching(/invalid_grant: Token is not active.*Connect again\.$/) });
      expect(yield* connectionOf("coffee")).toMatchObject({ state: "expired", renews: false });
    }),
  );

  it.effect("disconnects, and an edited address needs a new sign-in", () =>
    Effect.gen(function* () {
      const back = yield* signInPage((yield* connectOk("coffee")).authorizationUrl);
      expect((yield* callback(back)).location).toBe("/settings?mcp-connected=coffee");
      expect((yield* connectionOf("coffee"))?.state).toBe("connected");

      const current = yield* HttpClient.get("/api/mcp-servers/coffee").pipe(Effect.flatMap((response) => response.json));
      yield* saveServer("coffee", { ...COFFEE, transport: { type: "http", url: `${keycloak.mcpUrl}/v2`, headers: {} } }, (current as { hash: string }).hash);
      expect((yield* connectionOf("coffee"))?.state).toBe("changed");
      expect((yield* authorization("coffee").pipe(Effect.flip)).reason).toMatch(/address or client id changed/);

      const disconnected = yield* HttpClient.execute(HttpClientRequest.delete("/api/mcp-servers/coffee/connection")).pipe(Effect.flatMap((response) => response.json));
      expect(disconnected).toMatchObject({ connection: { serverId: "coffee", state: "disconnected" } });
      expect((yield* authorization("coffee").pipe(Effect.flip)).reason).toMatch(/^Not signed in to Coffee journal/);
      expect(JSON.parse(readFileSync(join(root, "data", "secrets.enc"), "utf8")).credentials).toEqual({});
    }),
  );

  it.effect("registers a client when the file names none (Jira), finishes from a pasted address, and reuses the client", () =>
    Effect.gen(function* () {
      yield* saveServer("jira", server(atlassian.mcpUrl, { title: "Jira" }));
      const started = yield* connectOk("jira");
      expect(atlassian.registrations).toEqual([
        {
          client_name: "Wiki agents",
          redirect_uris: [started.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "journal:read offline_access",
        },
      ]);
      expect(new URL(started.authorizationUrl).searchParams.get("client_id")).toBe("registered-1");

      // Signed in somewhere the callback couldn't reach: paste the address.
      const pasted = yield* signInPage(started.authorizationUrl);
      const finished = yield* HttpClient.execute(HttpClientRequest.post("/api/mcp-servers/oauth/finish").pipe(HttpClientRequest.bodyJsonUnsafe({ url: `  ${pasted}\n` }))).pipe(
        Effect.flatMap(decode(FinishConnectResponse)),
      );
      expect(finished.connection).toMatchObject({ serverId: "jira", state: "connected", issuer: atlassian.issuer });
      const notAnAddress = yield* HttpClient.execute(HttpClientRequest.post("/api/mcp-servers/oauth/finish").pipe(HttpClientRequest.bodyJsonUnsafe({ url: "code=1" })));
      expect(notAnAddress.status).toBe(400);

      // Disconnecting keeps the registered client; connecting again reuses it.
      yield* HttpClient.execute(HttpClientRequest.delete("/api/mcp-servers/jira/connection"));
      expect(new URL((yield* connectOk("jira")).authorizationUrl).searchParams.get("client_id")).toBe("registered-1");
      expect(atlassian.registrations).toHaveLength(1);
    }),
  );

  it.effect("says why a server can't be signed in to", () =>
    Effect.gen(function* () {
      const reason = (id: string) => connect(id).pipe(Effect.flatMap((response) => Effect.map(response.text, (text) => `${response.status} ${text}`)));
      yield* saveServer("no-client", server(keycloak.mcpUrl, { title: "No client" }));
      expect(yield* reason("no-client")).toMatch(/^409 The identity server .* doesn't let apps register themselves; give No client a client id under Sign-in\.$/);
      yield* saveServer("token", server(keycloak.mcpUrl, { title: "Token", transport: { type: "http", url: keycloak.mcpUrl, headers: { authorization: "Bearer ${secret:t}" } } }));
      expect(yield* reason("token")).toBe("409 Token sends its own Authorization header; remove it to sign in instead.");
      yield* saveServer("open", server(`${keycloak.base}/open`, { title: "Open" }));
      expect(yield* reason("open")).toMatch(/^409 127\.0\.0\.1:\d+ didn't ask to sign in \(it answered 404\)/);
      expect(yield* reason("missing")).toMatch(/^404 /);
      // Only servers that can sign in are listed.
      expect((yield* connections).connections.map((connection) => connection.serverId).sort()).toEqual(["coffee", "jira", "no-client", "open"]);
    }),
  );

  it.effect("shows the identity server's refusal on Settings", () =>
    Effect.gen(function* () {
      yield* saveServer("coffee-again", COFFEE);
      const back = yield* signInPage((yield* connectOk("coffee-again")).authorizationUrl, { prompt: "deny" });
      expect(yield* callback(back)).toEqual({ status: 303, location: "/settings?mcp-connect-failed=The identity server didn't sign you in: You said no." });
      expect((yield* connectionOf("coffee-again"))?.state).toBe("disconnected");
    }),
  );
});
