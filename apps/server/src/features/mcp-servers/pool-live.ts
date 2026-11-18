import { homedir } from "node:os";
import type { McpServerStatus, McpToolInfo } from "@wiki-agents/contracts/mcp-servers/model";
import { Cause, type Duration, Effect, Exit, FileSystem, Layer, Option, RcMap, Schema, Scope } from "effect";
import { McpClient, type McpClientError, McpProtocol, McpSchema } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { networkReason } from "../../shared/network-reason.js";
import { type EnvironmentSource, makeProviderEnvironment } from "../../shared/provider-environment.js";
import { SecretMaterial } from "../secrets/material.js";
import { WallClock } from "../../shared/wall-clock.js";
import { McpConnections } from "../mcp-oauth/connections.js";
import { SecretStore } from "../secrets/secret-store.js";
import { McpServerCatalog } from "./catalog.js";
import { type McpServerDefinition, signsIn } from "./definition.js";
import { McpCallFailed, McpPool, type McpScopeContext, McpServerUnavailable, McpToolNotFound, type McpToolResult } from "./pool.js";
import { makeRedactor, redactJson } from "./redaction.js";
import { resolveReferences } from "./references.js";

/** How the app introduces itself to servers. */
const CLIENT_INFO = { name: "wiki-agents", version: "0.1.0" } as const;

/** A connection nobody has used for this long is closed (a stdio server's process stops). */
export const IDLE_TIME_TO_LIVE: Duration.Input = "10 minutes";
/** Connecting and listing tools must each finish within this. */
export const CONNECT_TIMEOUT: Duration.Input = "30 seconds";
/** After a failed connect, wait this long before the next try, doubling up to `BACKOFF_MAX_MS`. */
export const BACKOFF_FIRST_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
/**
 * How long a sign-in's `Authorization` header is reused before asking for it again.
 * Asking may decrypt the secrets store (and run `systemd-creds`); tokens are renewed a
 * minute before they run out, so one fetched now still works for longer than this.
 */
const AUTHORIZATION_REUSE_MS = 30_000;

type Protocol = McpProtocol.ProtocolAdapter<McpClient.ProtocolVersion>;

/**
 * MCP versions to try, newest first. Effect's client is typed for 2025-11-25 and
 * 2026-07-28 only, and asks for exactly one version, failing if the server answers with
 * another. Many servers still speak 2025-06-18 or 2025-03-26, whose start-up (initialize,
 * then requests) the client's 2025-11-25 path also does; their adapters supply each
 * version's schemas. Tested against a stand-in that speaks only 2025-06-18
 * (`mcp-pool.integration.test.ts`). Kept here so an Effect upgrade has one place to check.
 */
const PROTOCOLS: ReadonlyArray<Protocol> = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18 as unknown as Protocol,
  McpProtocol.v2025_03_26 as unknown as Protocol,
  McpProtocol.v2026_07_28,
];

/** One open connection, shared by every request with the same server and scope key. */
interface Connection {
  readonly client: McpClient.McpClient;
  readonly tools: ReadonlyArray<McpSchema.Tool>;
  readonly protocolVersion: string;
  /** Hides every secret this connection was given, and the sign-in tokens it sent. */
  readonly redact: (text: string) => string;
}

/** What the pool remembers about a server between connections, for Settings. */
interface Known {
  readonly tools: ReadonlyArray<McpSchema.Tool> | null;
  readonly listedAt: number | null;
  readonly protocolVersion: string | null;
  readonly problem: string | null;
}

interface Backoff {
  readonly failures: number;
  readonly retryAt: number;
}

/** An entry in the map, by identity, so an invalidated one closing later doesn't remove its replacement. */
interface Entry {
  readonly serverId: string;
  /** The server's settings it was opened with; different settings open a new connection. */
  readonly fingerprint: string;
}

const NOTHING_KNOWN: Known = { tools: null, listedAt: null, protocolVersion: null, problem: null };

/** The connection a request uses: `<server>|<scope key>`. */
export const connectionKey = (server: McpServerDefinition, context: McpScopeContext) => {
  switch (server.scope) {
    case "app":
      return `${server.id}|app`;
    case "project":
      return context.projectId === null ? `${server.id}|thread:${context.threadId}` : `${server.id}|project:${context.projectId}`;
    case "thread":
      return `${server.id}|thread:${context.threadId}`;
  }
};

const fingerprintOf = (server: McpServerDefinition) => JSON.stringify([server.transport, server.scope, server.oauth, server.excludeTools]);

/** The server's tools without those its settings leave out. */
export const withoutExcluded = (server: Pick<McpServerDefinition, "excludeTools">, tools: ReadonlyArray<McpSchema.Tool>) =>
  server.excludeTools.length === 0 ? tools : tools.filter((tool) => !server.excludeTools.includes(tool.name));

const toolInfo = (tool: McpSchema.Tool): McpToolInfo => ({
  name: tool.name,
  title: tool.title ?? tool.annotations?.title ?? null,
  description: tool.description ?? null,
  readOnly: tool.annotations?.readOnlyHint === true,
});

/** Failures that mean "try another MCP version", not "the server is down or refused". */
const isVersionProblem = (error: McpClientError.McpClientError) => {
  const reason = error.reason;
  return reason._tag === "UnsupportedError" || reason._tag === "ProtocolError" || (reason._tag === "HttpError" && reason.status === 400);
};

/** Failures after which the connection can't be used again. */
const isConnectionProblem = (error: McpClientError.McpClientError) => {
  const tag = error.reason._tag;
  return tag === "TransportError" || tag === "ClosedError" || (error.reason._tag === "HttpError" && (error.reason.status === 401 || error.reason.status === 403));
};

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

export interface McpPoolOptions {
  /** What a stdio server's environment starts with, before its own `env`: what providers get. */
  readonly environment: EnvironmentSource;
  readonly idleTimeToLive?: Duration.Input;
}

export const makeMcpPool = (options: McpPoolOptions) =>
  Effect.gen(function* () {
    const catalog = yield* McpServerCatalog;
    const connections = yield* McpConnections;
    const secrets = yield* SecretStore;
    const clock = yield* WallClock;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // Its own client: requests go to the servers' URLs, never through anything a test or the app provides.
    const http = yield* Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer);

    const known = new Map<string, Known>();
    const backoffs = new Map<string, Backoff>();
    const current = new Map<string, Entry>();
    const open = new Set<Entry>();
    /** What the next lookup of a key connects to; set just before `RcMap.get`. */
    const requests = new Map<string, { readonly server: McpServerDefinition; readonly cwd: string | null }>();
    /** The version each server spoke last, tried first next time. */
    const versions = new Map<string, Protocol>();
    /** Sign-in headers by server, reused for a short while; tokens remembered for redaction. */
    const authorizations = new Map<string, { readonly header: string | null; readonly until: number; readonly signInProblem: string | null }>();
    const tokensSent = new Map<string, Set<string>>();

    const remember = (serverId: string, update: Partial<Known>) => known.set(serverId, { ...(known.get(serverId) ?? NOTHING_KNOWN), ...update });

    const sources = {
      secret: (name: string) => secrets.resolve(name),
      env: process.env,
      readFile: (path: string) => fs.readFileString(path),
    };

    /** The `Authorization` header for a server the app signs in to; null when not signed in (the server may not need it). */
    const authorization = (serverId: string) =>
      Effect.gen(function* () {
        const now = yield* clock.now;
        const cached = authorizations.get(serverId);
        if (cached !== undefined && now < cached.until) return cached.header;
        const header = yield* connections.authorization(serverId).pipe(
          Effect.map((value) => ({ header: value, signInProblem: null })),
          Effect.catchTags({
            SignInNeeded: (error) => Effect.succeed({ header: null, signInProblem: error.reason }),
            McpServerNotFound: () => Effect.succeed({ header: null, signInProblem: null }),
          }),
        );
        authorizations.set(serverId, { ...header, until: now + AUTHORIZATION_REUSE_MS });
        if (header.header !== null) {
          const tokens = tokensSent.get(serverId) ?? new Set();
          tokens.add(header.header.replace(/^Bearer\s+/i, ""));
          // Old tokens could still be echoed in a late answer; a few are enough.
          while (tokens.size > 4) tokens.delete(tokens.values().next().value as string);
          tokensSent.set(serverId, tokens);
        }
        return header.header;
      });

    const redactorFor = (serverId: string, used: ReadonlyArray<string>) => (text: string) => makeRedactor([...used, ...(tokensSent.get(serverId) ?? [])])(text);

    /** Why a connection or call failed, in words for Settings or an agent, without secrets. */
    const describe = (server: McpServerDefinition, error: McpClientError.McpClientError): string => {
      const reason = error.reason;
      switch (reason._tag) {
        case "HttpError": {
          if (reason.status === 401) {
            if (!signsIn(server)) return `${server.title} refused its Authorization header (401); check the secret it refers to.`;
            const problem = authorizations.get(server.id)?.signInProblem;
            return `${server.title} asks you to sign in${problem ? `: ${problem}` : "; press Connect on Settings › MCP servers."}`;
          }
          return `${server.title} answered ${reason.status}${reason.description ? `: ${reason.description}` : "."}`;
        }
        case "TransportError":
          return `${reason.description}${reason.cause === undefined ? "" : `: ${networkReason(reason.cause)}`}`;
        case "TimeoutError":
          return `${server.title} didn't answer in time (${reason.operation}).`;
        case "UnsupportedError":
          return `${server.title} doesn't speak an MCP version the app knows (${PROTOCOLS.map((protocol) => protocol.protocolVersion).join(", ")}): ${reason.description ?? reason.message}`;
        default:
          return error.message;
      }
    };

    /** Opens the transport and client with one MCP version and lists the tools. */
    const openWith = (server: McpServerDefinition, protocol: Protocol, values: Readonly<Record<string, string>>, cwd: string | null) =>
      Effect.gen(function* () {
        const transport =
          server.transport.type === "stdio"
            ? yield* McpClient.stdio({
                command: ChildProcess.make(server.transport.command, server.transport.args, {
                  cwd: server.transport.cwd ?? cwd ?? homedir(),
                  env: { ...options.environment(), ...values },
                  extendEnv: false,
                }),
                protocol,
              }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
            : yield* McpClient.http({ url: server.transport.url, protocol, headers: values }).pipe(
                Effect.provideService(
                  HttpClient.HttpClient,
                  signsIn(server)
                    ? HttpClient.mapRequestEffect(http, (request) =>
                        Effect.map(authorization(server.id), (header) => (header === null ? request : HttpClientRequest.setHeader(request, "authorization", header))),
                      )
                    : http,
                ),
              );
        const client = yield* McpClient.make({ ...CLIENT_INFO, timeout: CONNECT_TIMEOUT }).pipe(Effect.provideService(McpClient.Transport, transport));
        // Left out here, so no agent is given them, Test doesn't list them and a call to one is refused as unknown.
        const tools = withoutExcluded(server, yield* client.listTools());
        return { client, tools, protocolVersion: protocol.protocolVersion };
      });

    /** A connection in the caller's scope: references filled in, then each MCP version in turn until one works. */
    const connect = (server: McpServerDefinition, cwd: string | null) =>
      Effect.gen(function* () {
        const unavailable = (reason: string) => new McpServerUnavailable({ serverId: server.id, reason });
        const fields = server.transport.type === "stdio" ? (["transport.env", server.transport.env] as const) : (["transport.headers", server.transport.headers] as const);
        const resolved = yield* resolveReferences(sources, fields[0], fields[1]).pipe(Effect.mapError((error) => unavailable(error.reason)));
        const redact = redactorFor(server.id, resolved.used);
        const preferred = versions.get(server.id);
        const order = preferred === undefined ? PROTOCOLS : [preferred, ...PROTOCOLS.filter((protocol) => protocol !== preferred)];
        const scope = yield* Effect.scope;
        let failure: McpClientError.McpClientError | undefined;
        for (const protocol of order) {
          const attempt = yield* Scope.fork(scope, "sequential");
          const exit = yield* Effect.exit(Scope.provide(openWith(server, protocol, resolved.values, cwd), attempt));
          if (Exit.isSuccess(exit)) {
            versions.set(server.id, protocol);
            const connection: Connection = { ...exit.value, redact };
            return connection;
          }
          yield* Scope.close(attempt, exit);
          const error = Cause.findErrorOption(exit.cause);
          // Interrupted, or a defect: nothing to try another version for.
          if (Option.isNone(error)) return yield* Effect.failCause(exit.cause as Cause.Cause<never>);
          failure = error.value;
          if (!isVersionProblem(failure)) break;
        }
        return yield* unavailable(failure === undefined ? `${server.title} can't be reached.` : redact(describe(server, failure)));
      });

    const backoffAfter = (failures: number) => Math.min(BACKOFF_FIRST_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);

    const map: RcMap.RcMap<string, Connection, McpServerUnavailable> = yield* RcMap.make({
      lookup: (key: string) =>
        Effect.gen(function* () {
          const request = requests.get(key);
          if (request === undefined) return yield* Effect.die(new Error(`No request for MCP connection ${key}`));
          const { server } = request;
          const now = yield* clock.now;
          const connection = yield* connect(server, request.cwd).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                const failures = (backoffs.get(key)?.failures ?? 0) + 1;
                backoffs.set(key, { failures, retryAt: now + backoffAfter(failures) });
                remember(server.id, { problem: error.reason });
              }),
            ),
          );
          backoffs.delete(key);
          remember(server.id, { tools: connection.tools, listedAt: now, protocolVersion: connection.protocolVersion, problem: null });
          const entry: Entry = { serverId: server.id, fingerprint: fingerprintOf(server) };
          current.set(key, entry);
          open.add(entry);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              open.delete(entry);
              if (current.get(key) === entry) current.delete(key);
            }),
          );
          return connection;
        }),
      idleTimeToLive: options.idleTimeToLive ?? IDLE_TIME_TO_LIVE,
    });

    const invalidate = (key: string) =>
      Effect.suspend(() => {
        current.delete(key);
        return RcMap.invalidate(map, key);
      });

    /** Runs `use` with the connection for `context`, opening it first unless the last try failed too recently. */
    const withConnection = <A, E>(server: McpServerDefinition, context: McpScopeContext, use: (connection: Connection, key: string) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const key = connectionKey(server, context);
        const live = current.get(key);
        if (live !== undefined && live.fingerprint !== fingerprintOf(server)) yield* invalidate(key);
        const backoff = backoffs.get(key);
        const now = yield* clock.now;
        if (backoff !== undefined && now < backoff.retryAt) {
          const problem = known.get(server.id)?.problem ?? `${server.title} can't be reached.`;
          return yield* new McpServerUnavailable({ serverId: server.id, reason: `${problem} Trying again in ${seconds(backoff.retryAt - now)}.` });
        }
        requests.set(key, { server, cwd: context.cwd });
        // RcMap keeps a failed lookup until it idles out; the backoff above decides when to try again instead.
        const connection = RcMap.get(map, key).pipe(Effect.tapError(() => RcMap.invalidate(map, key)));
        return yield* Effect.scoped(Effect.flatMap(connection, (opened) => use(opened, key)));
      });

    const serverIdOfKey = (key: string) => key.slice(0, key.indexOf("|"));

    const statusOf = (serverId: string, now: number): McpServerStatus => {
      const facts = known.get(serverId) ?? NOTHING_KNOWN;
      const count = [...open].filter((entry) => entry.serverId === serverId).length;
      const waits = [...backoffs].filter(([key, backoff]) => serverIdOfKey(key) === serverId && backoff.retryAt > now).map(([, backoff]) => backoff.retryAt);
      return {
        serverId,
        state: count > 0 ? "connected" : facts.problem === null ? "idle" : "failed",
        connections: count,
        tools: facts.tools === null ? null : facts.tools.map(toolInfo),
        listedAt: facts.listedAt,
        protocolVersion: facts.protocolVersion,
        problem: facts.problem,
        retryAt: waits.length === 0 ? null : Math.max(...waits),
      };
    };

    const statusNow = (serverId: string) => Effect.map(clock.now, (now) => statusOf(serverId, now));

    const forget = (serverId: string) =>
      Effect.gen(function* () {
        for (const key of [...current.keys()].filter((key) => serverIdOfKey(key) === serverId)) yield* invalidate(key);
        for (const key of [...backoffs.keys()].filter((key) => serverIdOfKey(key) === serverId)) backoffs.delete(key);
        authorizations.delete(serverId);
        remember(serverId, { problem: null });
      });

    const serverOf = (serverId: string) => Effect.map(catalog.get(serverId), ({ server }) => server);

    /** A `scope: app` connection: the same for every thread, so a thread id isn't needed. */
    const APP_CONTEXT: McpScopeContext = { threadId: "", projectId: null, cwd: null };

    return McpPool.of({
      statuses: Effect.gen(function* () {
        const { servers } = yield* catalog.current;
        const now = yield* clock.now;
        return servers.map((server) => statusOf(server.id, now));
      }),

      test: (serverId) =>
        Effect.gen(function* () {
          const server = yield* serverOf(serverId);
          authorizations.delete(serverId);
          const tested = yield* Effect.scoped(connect(server, null)).pipe(Effect.result);
          const now = yield* clock.now;
          if (tested._tag === "Success") {
            remember(serverId, { tools: tested.success.tools, listedAt: now, protocolVersion: tested.success.protocolVersion, problem: null });
            for (const key of [...backoffs.keys()].filter((key) => serverIdOfKey(key) === serverId)) backoffs.delete(key);
          } else {
            remember(serverId, { problem: tested.failure.reason });
          }
          return statusOf(serverId, now);
        }),

      restart: (serverId) =>
        Effect.gen(function* () {
          yield* forget(serverId);
          const server = yield* serverOf(serverId);
          if (server.scope === "app") yield* withConnection(server, APP_CONTEXT, () => Effect.void).pipe(Effect.ignore);
          return yield* statusNow(serverId);
        }),

      tools: (serverId, context) => Effect.flatMap(serverOf(serverId), (server) => withConnection(server, context, (connection) => Effect.succeed(connection.tools))),

      callTool: (serverId, context, name, args, callOptions) =>
        Effect.gen(function* () {
          const server = yield* serverOf(serverId);
          return yield* withConnection(server, context, (connection, key) =>
            Effect.gen(function* () {
              const tool = connection.tools.find((candidate) => candidate.name === name);
              if (tool === undefined) return yield* new McpToolNotFound({ serverId, tool: name });
              const result = yield* connection.client.callTool({ tool, arguments: { ...args } }, { timeout: callOptions?.timeout }).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    const reason = connection.redact(describe(server, error));
                    if (!isConnectionProblem(error)) return yield* new McpCallFailed({ serverId, tool: name, reason });
                    // The connection is gone (the process exited, the session ended, the token was refused): the next use opens a new one, with a fresh token.
                    remember(serverId, { problem: reason });
                    authorizations.delete(serverId);
                    yield* invalidate(key);
                    return yield* new McpServerUnavailable({ serverId, reason });
                  }),
                ),
              );
              const encoded = yield* Schema.encodeUnknownEffect(McpSchema.CallToolResult)(result).pipe(
                Effect.mapError(() => new McpCallFailed({ serverId, tool: name, reason: `${server.title} sent a result the app can't read.` })),
              );
              return redactJson(encoded, connection.redact) as McpToolResult;
            }),
          );
        }),
    });
  });

/**
 * The pool, with stdio servers started in the environment providers get: no server
 * sees the variables other servers take secrets from, only what its own `env` gives it.
 */
export const McpPoolLive = Layer.effect(
  McpPool,
  Effect.gen(function* () {
    const material = yield* SecretMaterial;
    return yield* makeMcpPool({ environment: yield* makeProviderEnvironment(() => material.latest().envNames) });
  }),
);
