import { type McpConnection, OAUTH_CALLBACK_PATH } from "@wiki-agents/contracts/mcp-oauth/model";
import { Effect, Layer, Option, Ref, Result, Semaphore } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import type { McpServerDefinition } from "../mcp-servers/definition.js";
import { SecretStore } from "../secrets/secret-store.js";
import { McpConnections, type SignInAnswer, SignInFailed, SignInNeeded, SignInUnknown } from "./connections.js";
import { discover, registerClient, tokenRequest, type Tokens } from "./oauth-client.js";
import { authorizationUrl, chooseScopes, newState, pkcePair } from "./protocol.js";
import { CREDENTIAL_PREFIX, credentialKey, parseStored, type StoredClient, type StoredConnection, type StoredTokens, storedText } from "./stored.js";

/** How long the sign-in page may take. */
export const SIGN_IN_MS = 10 * 60_000;
/** Renew a token this long before it runs out, so a request never starts with one about to. */
export const RENEW_EARLY_MS = 60_000;
/** Sign-ins waiting at once; the oldest goes first. */
const MAX_WAITING = 32;

/** A sign-in started and not finished: in memory only, so a restart drops it. */
interface Waiting {
  readonly serverId: string;
  readonly serverUrl: string;
  readonly configuredClientId: string | null;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly resource: string;
  readonly client: StoredClient;
  readonly scopes: ReadonlyArray<string>;
  readonly verifier: string;
  readonly expiresAt: number;
}

/** Whether a server is one the app signs in to: reached by URL, without an `Authorization` header of its own. */
export const signsIn = (server: McpServerDefinition) =>
  server.transport.type === "http" && !Object.keys(server.transport.headers).some((name) => name.toLowerCase() === "authorization");

const configuredClientId = (server: McpServerDefinition) => server.oauth?.clientId ?? null;
const urlOf = (server: McpServerDefinition) => (server.transport.type === "http" ? server.transport.url : "");

/** Whether the server's file still matches what was signed in to. */
const unchanged = (server: McpServerDefinition | null, stored: StoredConnection) =>
  server === null || (urlOf(server) === stored.serverUrl && configuredClientId(server) === stored.configuredClientId);

const view = (serverId: string, server: McpServerDefinition | null, stored: Option.Option<StoredConnection>, now: number): McpConnection => {
  const empty = { serverId, connectedAt: null, expiresAt: null, renews: false, scopes: [], issuer: null };
  if (Option.isNone(stored)) return { ...empty, state: "disconnected", problem: null };
  const { tokens, issuer, problem } = stored.value;
  if (tokens === null) return { ...empty, issuer, state: "disconnected", problem };
  const known = { serverId, connectedAt: tokens.connectedAt, expiresAt: tokens.expiresAt, renews: tokens.refreshToken !== null, scopes: tokens.scopes, issuer, problem };
  if (!unchanged(server, stored.value)) return { ...known, state: "changed", problem: "The server's address or client id changed since you signed in; connect again." };
  const ranOut = tokens.expiresAt !== null && now >= tokens.expiresAt && tokens.refreshToken === null;
  return { ...known, state: ranOut ? "expired" : "connected" };
};

const tokensAt = (now: number, tokens: Tokens, requested: ReadonlyArray<string>, previous: StoredTokens | null): StoredTokens => ({
  accessToken: tokens.accessToken,
  // A renewal that doesn't send a new refresh token leaves the old one in force (RFC 6749 §6).
  refreshToken: tokens.refreshToken ?? previous?.refreshToken ?? null,
  expiresAt: tokens.expiresIn === null ? null : now + tokens.expiresIn * 1000,
  scopes: tokens.scope === null ? (previous?.scopes ?? requested) : tokens.scope.split(/\s+/).filter((scope) => scope !== ""),
  connectedAt: previous?.connectedAt ?? now,
});

export const McpConnectionsLive = Layer.effect(
  McpConnections,
  Effect.gen(function* () {
    const catalog = yield* McpServerCatalog;
    const secrets = yield* SecretStore;
    const clock = yield* WallClock;
    const waiting = yield* Ref.make(new Map<string, Waiting>());
    /** One renewal at a time, so two requests don't both spend a refresh token the identity server rotates. */
    const renewing = yield* Semaphore.make(1);

    const readAll = secrets.readCredentials(CREDENTIAL_PREFIX);
    const readOne = (serverId: string) => Effect.map(readAll, (values) => parseStored(values.get(credentialKey(serverId))));
    const write = (serverId: string, stored: StoredConnection | null) => secrets.writeCredential(credentialKey(serverId), stored === null ? null : storedText(stored));
    const serverOrNull = (serverId: string) => catalog.get(serverId).pipe(Effect.map(({ server }) => server), Effect.orElseSucceed(() => null));

    const list = Effect.gen(function* () {
      const servers = (yield* catalog.current).servers.filter(signsIn);
      const now = yield* clock.now;
      const stored = yield* readAll.pipe(Effect.result);
      return servers.map((server) =>
        Result.isFailure(stored)
          ? { ...view(server.id, server, Option.none(), now), state: "unreadable" as const, problem: stored.failure.reason }
          : view(server.id, server, parseStored(stored.success.get(credentialKey(server.id))), now),
      );
    });

    const start = Effect.fnUntraced(function* (serverId: string, origin: string) {
      const { server } = yield* catalog.get(serverId);
      if (server.transport.type !== "http") return yield* new SignInFailed({ reason: `${server.title} runs as a command; only servers reached by URL sign in.` });
      if (!signsIn(server)) return yield* new SignInFailed({ reason: `${server.title} sends its own Authorization header; remove it to sign in instead.` });
      const redirectUri = new URL(OAUTH_CALLBACK_PATH, origin).toString();
      const found = yield* discover(server.transport.url);
      const scopes = chooseScopes({ configured: server.oauth?.scopes ?? [], challenged: found.challenged, advertised: found.advertised, offered: found.offered });
      const stored = yield* readOne(serverId);
      const clientId = configuredClientId(server);

      let client: StoredClient;
      if (clientId !== null) {
        client = { clientId, clientSecret: null, auth: "none", registered: false, redirectUri };
      } else if (Option.isSome(stored) && stored.value.client.registered && stored.value.issuer === found.issuer && stored.value.client.redirectUri === redirectUri) {
        client = stored.value.client;
      } else if (found.registrationEndpoint !== null) {
        client = yield* registerClient({ endpoint: found.registrationEndpoint, redirectUri, scopes });
      } else {
        return yield* new SignInFailed({ reason: `The identity server ${found.issuer} doesn't let apps register themselves; give ${server.title} a client id under Sign-in.` });
      }

      const { verifier, challenge } = pkcePair();
      const state = newState();
      const now = yield* clock.now;
      const expiresAt = now + SIGN_IN_MS;
      yield* Ref.update(waiting, (current) => {
        const next = new Map([...current].filter(([, entry]) => entry.expiresAt > now));
        while (next.size >= MAX_WAITING) next.delete(next.keys().next().value as string);
        return next.set(state, {
          serverId,
          serverUrl: server.transport.type === "http" ? server.transport.url : "",
          configuredClientId: clientId,
          issuer: found.issuer,
          tokenEndpoint: found.tokenEndpoint,
          resource: found.resource,
          client,
          scopes,
          verifier,
          expiresAt,
        });
      });
      const url = authorizationUrl({ endpoint: found.authorizationEndpoint, clientId: client.clientId, redirectUri, challenge, state, scopes, resource: found.resource });
      return { authorizationUrl: url, redirectUri, expiresAt };
    });

    const finish = Effect.fnUntraced(function* (answer: SignInAnswer) {
      const unknown = new SignInUnknown({
        reason: "This isn't a sign-in the app is waiting for: it was finished already, started over 10 minutes ago, or the app has restarted since. Connect again.",
      });
      if (answer.state === null) return yield* unknown;
      const state = answer.state;
      const entry = yield* Ref.modify(waiting, (current) => {
        const found = current.get(state);
        const next = new Map(current);
        next.delete(state);
        return [found, next] as const;
      });
      const now = yield* clock.now;
      if (entry === undefined || entry.expiresAt <= now) return yield* unknown;
      if (answer.error !== null) return yield* new SignInFailed({ reason: `The identity server didn't sign you in: ${(answer.errorDescription ?? answer.error).slice(0, 300)}` });
      if (answer.code === null) return yield* new SignInFailed({ reason: "The identity server sent no code back." });

      const tokens = yield* tokenRequest(entry.tokenEndpoint, entry.client, {
        grant_type: "authorization_code",
        code: answer.code,
        redirect_uri: entry.client.redirectUri,
        code_verifier: entry.verifier,
        resource: entry.resource,
      });
      const signedIn = yield* clock.now;
      const stored: StoredConnection = {
        version: 1,
        serverUrl: entry.serverUrl,
        configuredClientId: entry.configuredClientId,
        issuer: entry.issuer,
        tokenEndpoint: entry.tokenEndpoint,
        resource: entry.resource,
        client: entry.client,
        tokens: tokensAt(signedIn, tokens, entry.scopes, null),
        problem: null,
      };
      yield* write(entry.serverId, stored);
      return view(entry.serverId, yield* serverOrNull(entry.serverId), Option.some(stored), signedIn);
    });

    const disconnect = Effect.fnUntraced(function* (serverId: string) {
      const { server } = yield* catalog.get(serverId);
      const stored = yield* readOne(serverId).pipe(Effect.result);
      // A client the app registered is kept for next time; anything unreadable is dropped.
      const kept = Result.isSuccess(stored) && Option.isSome(stored.success) && stored.success.value.client.registered ? { ...stored.success.value, tokens: null, problem: null } : null;
      yield* write(serverId, kept);
      return view(serverId, server, Option.fromNullishOr(kept), yield* clock.now);
    });

    const authorization = (serverId: string) =>
      Effect.gen(function* () {
        const { server } = yield* catalog.get(serverId);
        const needed = (reason: string) => new SignInNeeded({ serverId, reason });
        const stored = yield* readOne(serverId).pipe(Effect.mapError((error) => needed(error.reason)));
        if (Option.isNone(stored) || stored.value.tokens === null) return yield* needed(`Not signed in to ${server.title}; connect it in Settings › MCP servers.`);
        const connection = stored.value;
        const tokens = stored.value.tokens;
        if (!unchanged(server, connection)) return yield* needed(`${server.title}'s address or client id changed since you signed in; connect again.`);
        const now = yield* clock.now;
        if (tokens.expiresAt === null || now < tokens.expiresAt - RENEW_EARLY_MS) return `Bearer ${tokens.accessToken}`;
        if (tokens.refreshToken === null) return yield* needed(`The sign-in to ${server.title} has run out; connect again.`);

        const renewed = yield* tokenRequest(connection.tokenEndpoint, connection.client, {
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          resource: connection.resource,
        }).pipe(Effect.result);
        if (Result.isFailure(renewed)) {
          const failure = renewed.failure;
          const reason = `Renewing the sign-in to ${server.title} failed: ${failure.reason}`;
          if (failure._tag === "GrantRejected") {
            yield* write(serverId, { ...connection, tokens: { ...tokens, refreshToken: null }, problem: reason }).pipe(Effect.ignore);
            return yield* needed(`${reason} Connect again.`);
          }
          // The identity server is unreachable or confused: keep the refresh token for next time.
          yield* write(serverId, { ...connection, problem: reason }).pipe(Effect.ignore);
          if (now < tokens.expiresAt) return `Bearer ${tokens.accessToken}`;
          return yield* needed(reason);
        }
        const next = tokensAt(yield* clock.now, renewed.success, tokens.scopes, tokens);
        yield* write(serverId, { ...connection, tokens: next, problem: null }).pipe(Effect.mapError((error) => needed(error.reason)));
        return `Bearer ${next.accessToken}`;
      }).pipe(renewing.withPermits(1));

    return McpConnections.of({ list, start, finish, disconnect, authorization });
  }),
);
