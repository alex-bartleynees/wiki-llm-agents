import { ListPinsResponse } from "@wiki-agents/contracts/pins/list-pins/response";
import { PinNoteRequest } from "@wiki-agents/contracts/pins/pin-note/request";
import { PinNoteResponse } from "@wiki-agents/contracts/pins/pin-note/response";
import { UnpinNoteResponse } from "@wiki-agents/contracts/pins/unpin-note/response";
import { deleteJson, getJson, postJson } from "#lib/api/client.ts";

const pinsPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}/pins`;

export const listPins = (vaultId: string, signal?: AbortSignal) => getJson(pinsPath(vaultId), ListPinsResponse, signal);

export const pinNote = (vaultId: string, path: string) => postJson(pinsPath(vaultId), PinNoteRequest, { path }, PinNoteResponse);

export const unpinNote = (vaultId: string, path: string) =>
  deleteJson(`${pinsPath(vaultId)}?path=${encodeURIComponent(path)}`, UnpinNoteResponse);
