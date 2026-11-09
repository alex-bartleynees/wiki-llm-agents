import type { GetTreeRequest } from "@wiki-agents/contracts/notes/get-tree/request";
import type { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

export const getTree = Effect.fn("getTree")(function* (request: GetTreeRequest) {
  const vault = yield* findVault(request.vaultId);
  const files = yield* (yield* VaultIndex).files(vault.id);
  const response: GetTreeResponse = { entries: files.map(({ path, kind }) => ({ path, kind })) };
  return response;
});
