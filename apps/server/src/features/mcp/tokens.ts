import { createHash, randomBytes } from "node:crypto";
import { Clock, Context, Duration, Effect, Layer, Option } from "effect";

/** Who is calling the vault tools: the thread the token was issued to, and its vault. */
export interface Caller {
  readonly threadId: string;
  readonly vaultId: string;
}

export interface IssuedToken {
  readonly token: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
}

/**
 * Bearer tokens for `/mcp`, one per thread at a time. Held in memory only, by hash,
 * so they end with the process; never logged, stored, or put in events.
 */
export interface McpTokensService {
  readonly issue: (caller: Caller) => Effect.Effect<IssuedToken>;
  /** The caller for a live token; None when unknown, revoked, or expired. */
  readonly verify: (token: string) => Effect.Effect<Option.Option<Caller>>;
  readonly revoke: (token: string) => Effect.Effect<void>;
}

export class McpTokens extends Context.Service<McpTokens, McpTokensService>()("McpTokens") {}

/** How long a token lives. A thread gets a new one well before then (see `vault-tools-live.ts`). */
export const TOKEN_TTL = Duration.hours(4);

const hash = (token: string) => createHash("sha256").update(token).digest("base64url");

export const McpTokensLive = Layer.sync(McpTokens, () => {
  const live = new Map<string, Caller & { readonly expiresAt: number }>();

  /** Drops expired tokens, so the map stays as small as the number of open threads. */
  const prune = (now: number) => {
    for (const [key, entry] of live) if (entry.expiresAt <= now) live.delete(key);
  };

  return McpTokens.of({
    issue: (caller) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        prune(now);
        const token = randomBytes(32).toString("base64url");
        const expiresAt = now + Duration.toMillis(TOKEN_TTL);
        live.set(hash(token), { threadId: caller.threadId, vaultId: caller.vaultId, expiresAt });
        return { token, expiresAt };
      }),
    verify: (token) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const entry = live.get(hash(token));
        if (entry === undefined || entry.expiresAt <= now) return Option.none();
        return Option.some({ threadId: entry.threadId, vaultId: entry.vaultId });
      }),
    revoke: (token) =>
      Effect.sync(() => {
        live.delete(hash(token));
      }),
  });
});
