import { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { getJson } from "#lib/api/client.ts";

const vaultPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}`;

export const getTree = (vaultId: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/tree`, GetTreeResponse, signal);

export const getNote = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/note?path=${encodeURIComponent(path)}`, GetNoteResponse, signal);

export const getBacklinks = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/backlinks?path=${encodeURIComponent(path)}`, GetBacklinksResponse, signal);
