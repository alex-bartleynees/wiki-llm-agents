import type { GetTreeRequest } from "@wiki-agents/contracts/notes/get-tree/request";
import type { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { fileKind } from "@wiki-agents/contracts/notes/model";
import { Effect } from "effect";
import { findVault } from "../find-vault.js";
import { listVaultFiles } from "../vault-files.js";

export const getTree = Effect.fn("getTree")(function* (request: GetTreeRequest) {
  const vault = yield* findVault(request.vaultId);
  const paths = yield* listVaultFiles(vault.rootPath);
  const response: GetTreeResponse = {
    entries: paths.map((path) => ({ path, kind: fileKind(path) })),
  };
  return response;
});
