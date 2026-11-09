import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { RegisterVaultRequest } from "@wiki-agents/contracts/vaults/register-vault/request";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { getJson, postJson } from "#lib/api/client.ts";

export const listVaults = (signal?: AbortSignal) => getJson("/api/vaults", ListVaultsResponse, signal);

export const registerVault = (request: RegisterVaultRequest) =>
  postJson("/api/vaults", RegisterVaultRequest, request, RegisterVaultResponse);
