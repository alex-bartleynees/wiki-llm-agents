import { Clock, Duration, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { McpGateway } from "./gateway.js";
import { MCP_PATH } from "./router.js";
import { type IssuedToken, McpTokens, TOKEN_TTL } from "./tokens.js";
import { entryName, VaultTools } from "./vault-tools.js";

/**
 * A token is replaced at the start of a turn once it has this long or less left, so a
 * turn never starts on one about to expire.
 */
const RENEW_BEFORE = Duration.toMillis(TOKEN_TTL) / 2;

/**
 * A URL a local process can reach this server on: a wildcard bind (`0.0.0.0`, `::`)
 * is reached on loopback.
 */
export const localUrl = (address: string, path: string) =>
  `${address.replace(/\/$/, "").replace("//0.0.0.0:", "//127.0.0.1:").replace("//[::]:", "//[::1]:")}${path}`;

/** The vault tools at this server's own address (`http://127.0.0.1:<port>/mcp`), with the gateway's tools. */
export const VaultToolsLive = Layer.effect(
  VaultTools,
  Effect.gen(function* () {
    const tokens = yield* McpTokens;
    const gateway = yield* McpGateway;
    const server = yield* HttpServer.HttpServer;
    const url = localUrl(HttpServer.formatAddress(server.address), MCP_PATH);
    return VaultTools.of({
      open: (caller) =>
        Effect.gen(function* () {
          const context = { threadId: caller.threadId, projectId: caller.projectId ?? null, cwd: caller.cwd ?? null };
          let issued: IssuedToken | undefined;
          let issuedFor = -1;
          let lastNotices = "[]";
          yield* Effect.addFinalizer(() => Effect.andThen(gateway.release(caller.threadId), issued === undefined ? Effect.void : tokens.revoke(issued.token)));
          const current = (agentServers: ReadonlyArray<string>) =>
            Effect.gen(function* () {
              const tools = yield* gateway.prepare(context, agentServers);
              const now = yield* Clock.currentTimeMillis;
              // A new token makes every provider register the entry again, and so list its tools again.
              if (issued === undefined || issued.expiresAt - now <= RENEW_BEFORE || issuedFor !== tools.revision) {
                const previous = issued;
                issued = yield* tokens.issue(caller);
                issuedFor = tools.revision;
                if (previous !== undefined) yield* tokens.revoke(previous.token);
              }
              // Said once, not every turn: a server that stays down is mentioned again when anything changes.
              const notices = JSON.stringify(tools.notices);
              const changed = notices !== lastNotices;
              lastNotices = notices;
              return { entry: { name: entryName(caller.threadId), url, token: issued.token, revision: tools.revision }, notices: changed ? tools.notices : [] };
            });
          return { current };
        }),
    });
  }),
);
