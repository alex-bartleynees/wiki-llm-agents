import { Clock, Duration, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
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

/** The vault tools at this server's own address (`http://127.0.0.1:<port>/mcp`). */
export const VaultToolsLive = Layer.effect(
  VaultTools,
  Effect.gen(function* () {
    const tokens = yield* McpTokens;
    const server = yield* HttpServer.HttpServer;
    const url = localUrl(HttpServer.formatAddress(server.address), MCP_PATH);
    return VaultTools.of({
      open: (caller) =>
        Effect.gen(function* () {
          let issued: IssuedToken | undefined;
          yield* Effect.addFinalizer(() => (issued === undefined ? Effect.void : tokens.revoke(issued.token)));
          const current = Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (issued === undefined || issued.expiresAt - now <= RENEW_BEFORE) {
              const previous = issued;
              issued = yield* tokens.issue(caller);
              if (previous !== undefined) yield* tokens.revoke(previous.token);
            }
            return { name: entryName(caller.threadId), url, token: issued.token };
          });
          return { current };
        }),
    });
  }),
);
