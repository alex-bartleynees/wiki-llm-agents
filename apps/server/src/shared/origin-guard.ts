import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Blocks cross-site writes: a page on another origin open in the same browser must
 * not be able to POST to this loopback server. Requests without an Origin header
 * (curl, the agent CLIs) are allowed; browsers always send one on cross-site writes.
 */
export const isAllowedRequest = (input: {
  readonly method: string;
  readonly origin: string | undefined;
  readonly host: string | undefined;
}): boolean => {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin === undefined) return true;
  if (input.host === undefined) return false;
  try {
    return new URL(input.origin).host === input.host;
  } catch {
    return false;
  }
};

export const OriginGuardLive = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const httpRequest = yield* HttpServerRequest.HttpServerRequest;
      const allowed = isAllowedRequest({
        method: httpRequest.method,
        origin: httpRequest.headers["origin"],
        host: httpRequest.headers["host"],
      });
      if (!allowed) {
        return HttpServerResponse.text("Cross-origin request blocked", { status: 403 });
      }
      return yield* httpEffect;
    }),
  { global: true },
);
