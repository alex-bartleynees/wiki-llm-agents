import type { SearchResult } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect, Option, Schema } from "effect";
import { AppConfig } from "../../shared/config.js";

const Chunks = Schema.Array(Schema.Struct({ source_file: Schema.String }));

export const ragAiUrlForVault = (rootPath: string) =>
  Effect.all([AppConfig.ragAiUrl, AppConfig.ragAiVaultRoot]).pipe(
    Effect.map(([url, root]) => Option.contains(root, rootPath) ? Option.getOrUndefined(url) : undefined),
    Effect.orElseSucceed(() => undefined),
  );

export const searchPaths = (baseUrl: string, query: string, k: number, folder?: string) =>
  Effect.tryPromise(async (signal) => {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Expected an HTTP rag-ai URL");
    url.pathname = url.pathname.replace(/\/$/, "") + "/search";
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, k, path_prefix: folder === undefined ? undefined : folder + "/" }),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
    if (!response.ok) throw new Error("rag-ai search failed with HTTP " + response.status);
    const chunks = Schema.decodeUnknownSync(Chunks)(await response.json());
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
