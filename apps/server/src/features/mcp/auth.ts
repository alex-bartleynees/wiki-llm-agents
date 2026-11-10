import { Context, Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type Caller, McpTokens } from "./tokens.js";

/** The thread calling a vault tool, from its bearer token. Tools act on its vault only. */
export class VaultCaller extends Context.Service<VaultCaller, Caller>()("VaultCaller") {}

const unauthorized = (message: string) =>
  HttpServerResponse.text(message, {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="wiki-agents"' },
  });

/** `Bearer <token>` → the token. */
export const bearerToken = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match?.[1];
};

/**
 * Every `/mcp` request needs a live thread token: anything else gets 401 before the
 * MCP server sees it. The token is never logged; error messages don't repeat it.
 */
export const McpAuth = HttpRouter.middleware<{ provides: VaultCaller }>()(
  Effect.gen(function* () {
    const tokens = yield* McpTokens;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = bearerToken(request.headers["authorization"]);
        if (token === undefined) return unauthorized("A bearer token is required.");
        const caller = yield* tokens.verify(token);
        if (Option.isNone(caller)) return unauthorized("The token is unknown or has expired.");
        return yield* Effect.provideService(httpEffect, VaultCaller, caller.value);
      });
  }),
);
