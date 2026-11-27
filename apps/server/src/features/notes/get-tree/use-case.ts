import type { GetTreeRequest } from "@wiki-agents/contracts/notes/get-tree/request";
import type { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { Effect } from "effect";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

export const getTreeEtag = Effect.fn("getTreeEtag")(function* (request: GetTreeRequest) {
  const vault = yield* findVault(request.vaultId);
  const etag = yield* (yield* VaultIndex).treeEtag(vault.id);
  return { vaultId: vault.id, etag };
});

export const getTreeForVault = Effect.fn("getTreeForVault")(function* (vaultId: string) {
  const files = yield* (yield* VaultIndex).titledFiles(vaultId);
  const response: GetTreeResponse = { entries: files.map(({ path, kind, title }) => ({ path, kind, title })) };
  return response;
});

export const getTree = Effect.fn("getTree")(function* (request: GetTreeRequest) {
  const vault = yield* findVault(request.vaultId);
  return yield* getTreeForVault(vault.id);
});
