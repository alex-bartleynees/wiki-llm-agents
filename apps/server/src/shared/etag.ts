import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

const stripWeak = (tag: string) => (tag.startsWith("W/") || tag.startsWith("w/") ? tag.slice(2) : tag);

export const matchesIfNoneMatch = (header: string | undefined, etag: string): boolean => {
  if (header === undefined) return false;
  const trimmed = header.trim();
  if (trimmed === "") return false;
  if (trimmed === "*") return true;
  const target = stripWeak(etag.trim());
  for (const part of trimmed.split(",")) {
    const candidate = part.trim();
    if (candidate === "*" || stripWeak(candidate) === target) return true;
  }
  return false;
};

export const respondWithEtag = <E, R>(
  etag: string,
  build: () => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
      return HttpServerResponse.empty({ status: 304, headers: { etag, "cache-control": "no-cache" } });
    }
    const response = yield* build();
    return HttpServerResponse.setHeaders(response, { etag, "cache-control": "no-cache" });
  });
