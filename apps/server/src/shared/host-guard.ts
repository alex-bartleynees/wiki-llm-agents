import { isIP } from "node:net";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

/**
 * Whether a `Host` header names this app directly: an IP address, `localhost`, or a
 * tailnet name (`*.ts.net`). A page on another site can point its own domain at
 * 127.0.0.1 (DNS rebinding) and then read this server's responses as "same origin";
 * its requests carry that domain as `Host`, so they are refused here.
 */
export const isTrustedHost = (host: string | undefined): boolean => {
  if (host === undefined || host === "") return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
  return isIP(name) !== 0 || name === "localhost" || name.endsWith(".localhost") || name.endsWith(".ts.net");
};

/**
 * Runs an endpoint that handles secrets or sign-ins only for a request addressed to
 * this app by a name it trusts.
 */
export const guarded = <E, R>(endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    isTrustedHost(request.headers["host"]) ? endpoint : Effect.succeed(HttpServerResponse.text("Secrets are served on localhost and the tailnet only", { status: 403 })),
  );
