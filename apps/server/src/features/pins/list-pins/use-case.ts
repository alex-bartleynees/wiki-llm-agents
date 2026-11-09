import type { ListPinsRequest } from "@wiki-agents/contracts/pins/list-pins/request";
import type { ListPinsResponse } from "@wiki-agents/contracts/pins/list-pins/response";
import { Effect } from "effect";
import { findVault } from "../../vaults/find-vault.js";
import { listVaultPins } from "../list.js";

export const listPins = Effect.fn("listPins")(function* (request: ListPinsRequest) {
  const vault = yield* findVault(request.vaultId);
  const response: ListPinsResponse = { pins: yield* listVaultPins(vault.id) };
  return response;
});
