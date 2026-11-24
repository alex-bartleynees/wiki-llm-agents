import type { SearchResult } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { AppConfig } from "../../shared/config.js";

const Chunks = Schema.Array(Schema.Struct({ source_file: Schema.String }));
const TIMEOUT = "3 seconds";

const RagAiHttp = Layer.fresh(FetchHttpClient.layer).pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ redirect: "error" })),
);

export const ragAiUrlForVault = (rootPath: string) =>
  Effect.all([AppConfig.ragAiUrl, AppConfig.ragAiVaultRoot]).pipe(
    Effect.map(([url, root]) => Option.contains(root, rootPath) ? Option.getOrUndefined(url) : undefined),
    Effect.orElseSucceed(() => undefined),
  );

const searchUrl = (baseUrl: string) =>
  Effect.gen(function* () {
    const url = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return yield* Effect.fail("Expected an HTTP rag-ai URL" as const);
    url.pathname = url.pathname.replace(/\/$/, "") + "/search";
    return url;
  });

export const searchPaths = (baseUrl: string, query: string, k: number, folder?: string) =>
  Effect.gen(function* () {
    const url = yield* searchUrl(baseUrl);
    const body = { query, k, path_prefix: folder === undefined ? undefined : folder + "/" };
    const chunks = yield* HttpClient.execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Chunks)),
      Effect.timeout(TIMEOUT),
      Effect.provide(RagAiHttp),
    );
    return [...new Set(chunks.slice(0, k).map((chunk) => chunk.source_file))];
  }).pipe(Effect.option);

export const fuseSearchResults = (keyword: ReadonlyArray<SearchResult>, semantic: ReadonlyArray<SearchResult>) => {
  const ranked = new Map<string, { result: SearchResult; score: number }>();
  for (const results of [keyword, semantic]) {
    results.forEach((result, rank) => {
      const score = 1 / (60 + rank + 1);
      const existing = ranked.get(result.path);
      ranked.set(result.path, existing === undefined
        ? { result, score }
        : { result: existing.result, score: existing.score + score });
    });
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score).map(({ result }) => result);
};
