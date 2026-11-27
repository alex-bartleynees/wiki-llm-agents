import type { QuickSwitchRequest } from "@wiki-agents/contracts/search/quick-switch/request";
import type { QuickSwitchResponse } from "@wiki-agents/contracts/search/quick-switch/response";
import { rankQuickSwitch } from "@wiki-agents/search/fuzzy";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

export const quickSwitch = Effect.fn("quickSwitch")(function* (request: QuickSwitchRequest) {
  const vault = yield* findVault(request.vaultId);
  const files = yield* (yield* VaultIndex).titledFiles(vault.id);
  const response: QuickSwitchResponse = { results: rankQuickSwitch(files, request.q) };
  return response;
});
