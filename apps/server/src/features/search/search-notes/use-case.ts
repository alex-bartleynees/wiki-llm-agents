import type { SearchNotesRequest } from "@wiki-agents/contracts/search/search-notes/request";
import type { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

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

export const searchNotes = Effect.fn("searchNotes")(function* (request: SearchNotesRequest) {
  const vault = yield* findVault(request.vaultId);
  const index = yield* VaultIndex;
  const response: SearchNotesResponse = yield* index.search(vault.id, {
    text: request.q ?? "",
    tags: parseTags(request.tags),
    limit: request.limit ?? DEFAULT_LIMIT,
  });
  return response;
});
