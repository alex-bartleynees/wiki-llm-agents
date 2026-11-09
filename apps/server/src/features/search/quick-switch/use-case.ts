import type { QuickSwitchRequest } from "@wiki-agents/contracts/search/quick-switch/request";
import type { QuickSwitchResponse, QuickSwitchResult } from "@wiki-agents/contracts/search/quick-switch/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";
import { fuzzyMatch, normaliseFuzzyQuery } from "../fuzzy.js";

const LIMIT = 20;
/** A title match beats a path match of the same quality: titles are what people remember. */
const TITLE_BONUS = 4;

/** Fuzzy-matches the query against the title and path of every file the app can show. */
export const quickSwitch = Effect.fn("quickSwitch")(function* (request: QuickSwitchRequest) {
  const vault = yield* findVault(request.vaultId);
  const query = normaliseFuzzyQuery(request.q);
  if (query === "") return { results: [] } satisfies QuickSwitchResponse;
  const files = yield* (yield* VaultIndex).titledFiles(vault.id);

  const scored: Array<{ readonly score: number; readonly result: QuickSwitchResult }> = [];
  for (const file of files) {
    if (file.kind === "file") continue;
    const byTitle = fuzzyMatch(query, file.title);
    const byPath = fuzzyMatch(query, file.path);
    const best =
      byTitle !== undefined && (byPath === undefined || byTitle.score + TITLE_BONUS >= byPath.score)
        ? { score: byTitle.score + TITLE_BONUS, field: "title" as const, positions: byTitle.positions }
        : byPath !== undefined
          ? { score: byPath.score, field: "path" as const, positions: byPath.positions }
          : undefined;
    if (best === undefined) continue;
    scored.push({
      score: best.score,
      result: { path: file.path, kind: file.kind, title: file.title, match: { field: best.field, positions: best.positions } },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.result.path.length - b.result.path.length || a.result.path.localeCompare(b.result.path));
  const response: QuickSwitchResponse = { results: scored.slice(0, LIMIT).map((entry) => entry.result) };
  return response;
});
