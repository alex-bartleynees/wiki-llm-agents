import type { ListTagsRequest } from "@wiki-agents/contracts/search/list-tags/request";
import type { ListTagsResponse } from "@wiki-agents/contracts/search/list-tags/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

export const listTags = Effect.fn("listTags")(function* (request: ListTagsRequest) {
  const vault = yield* findVault(request.vaultId);
  const response: ListTagsResponse = { tags: yield* (yield* VaultIndex).tags(vault.id) };
  return response;
});
