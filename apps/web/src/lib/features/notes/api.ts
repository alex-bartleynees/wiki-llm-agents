import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { getJson } from "#lib/api/client.ts";

export const getTree = (vaultId: string, signal?: AbortSignal) =>
  getJson(`/api/vaults/${encodeURIComponent(vaultId)}/tree`, GetTreeResponse, signal);

export const getNote = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(
    `/api/vaults/${encodeURIComponent(vaultId)}/note?path=${encodeURIComponent(path)}`,
    GetNoteResponse,
    signal,
  );
