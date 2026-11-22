import type { SearchNotesRequest } from "@wiki-agents/contracts/search/search-notes/request";
import type { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect, Option } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";
import { fuseSearchResults, ragAiUrlForVault, searchPaths } from "../semantic.js";

const DEFAULT_LIMIT = 50;

/** `"Project, #area/home,,"` → `["project", "area/home"]`. */
export const parseTags = (tags: string | undefined): ReadonlyArray<string> => [
  ...new Set(
    (tags ?? "")
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .filter((tag) => tag !== ""),
  ),
];

/** `folders` limits it to those vault-relative folders (an agent's knowledge sources). */
export const searchNotes = Effect.fn("searchNotes")(function* (request: SearchNotesRequest, folders?: ReadonlyArray<string>) {
  const vault = yield* findVault(request.vaultId);
  const index = yield* VaultIndex;
  const text = request.q ?? "";
  const tags = parseTags(request.tags);
  const limit = request.limit ?? DEFAULT_LIMIT;
  const keyword: SearchNotesResponse = yield* index.search(vault.id, { text, tags, limit, folders });
  if (text.trim() === "" || text.includes('"') || text.length > 8192 || (folders !== undefined && folders.length !== 1)) return keyword;

  const url = yield* ragAiUrlForVault(vault.rootPath);
  if (url === undefined) return keyword;

  const folder = folders?.[0];
  const paths = yield* searchPaths(url, text, Math.min(limit * 4, 100), folder);
  if (Option.isNone(paths)) return { ...keyword, mode: "keyword-fallback" } satisfies SearchNotesResponse;

  const scoped = folder === undefined ? paths.value : paths.value.filter((path) => path.startsWith(folder + "/"));
  const summaries = new Map((yield* index.notes(vault.id, scoped)).map((summary) => [summary.path, summary]));
  const semantic = scoped.flatMap((path) => {
    const summary = summaries.get(path);
    if (!summary || !tags.every((tag) => summary.tags.some((value) => {
      const normalized = value.toLowerCase();
      return normalized === tag || normalized.startsWith(tag + "/");
    }))) return [];
    return [{ ...summary, snippet: [] }];
  });
  const results = fuseSearchResults(keyword.results, semantic);
  return {
    results: results.slice(0, limit),
    truncated: keyword.truncated || results.length > limit,
    mode: "hybrid",
  } satisfies SearchNotesResponse;
});
