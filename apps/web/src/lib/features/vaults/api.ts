import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { RegisterVaultRequest } from "@wiki-agents/contracts/vaults/register-vault/request";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { UpdateVaultRequest } from "@wiki-agents/contracts/vaults/update-vault/request";
import { UpdateVaultResponse } from "@wiki-agents/contracts/vaults/update-vault/response";
import { getJson, patchJson, postJson } from "#lib/api/client.ts";

export const listVaults = (signal?: AbortSignal) => getJson("/api/vaults", ListVaultsResponse, signal);

export const registerVault = (request: RegisterVaultRequest) =>
  postJson("/api/vaults", RegisterVaultRequest, request, RegisterVaultResponse);

export const updateVault = (vaultId: string, request: UpdateVaultRequest) =>
  patchJson(`/api/vaults/${encodeURIComponent(vaultId)}`, UpdateVaultRequest, request, UpdateVaultResponse);
