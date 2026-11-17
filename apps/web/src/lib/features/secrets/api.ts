import { DeleteSecretResponse } from "@wiki-agents/contracts/secrets/delete-secret/response";
import { ListSecretsResponse } from "@wiki-agents/contracts/secrets/list-secrets/response";
import { SetSecretRequest } from "@wiki-agents/contracts/secrets/set-secret/request";
import { SetSecretResponse } from "@wiki-agents/contracts/secrets/set-secret/response";
import { deleteJson, getJson, putJson } from "#lib/api/client.ts";

const secretPath = (name: string) => `/api/secrets/${encodeURIComponent(name)}`;

/** Names, dates and users only: no endpoint returns a value. */
export const listSecrets = (signal?: AbortSignal) => getJson("/api/secrets", ListSecretsResponse, signal);

/** Stores the value encrypted on this machine, replacing one of the same name. 422 names the field; 409 for a declared name or an unreadable store. */
export const setSecret = (name: string, request: SetSecretRequest) => putJson(secretPath(name), SetSecretRequest, request, SetSecretResponse);

/** 409 while MCP servers use it, unless `force`. */
export const deleteSecret = (name: string, force: boolean) => deleteJson(`${secretPath(name)}${force ? "?force=true" : ""}`, DeleteSecretResponse);
