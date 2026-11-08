import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { getJson } from "#lib/api/client.ts";

export const listVaults = (signal?: AbortSignal) =>
  getJson("/api/vaults", ListVaultsResponse, signal ? { signal } : undefined);
