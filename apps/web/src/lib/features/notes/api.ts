import { DeleteNoteResponse } from "@wiki-agents/contracts/notes/delete-note/response";
import { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { GetNoteSourceResponse } from "@wiki-agents/contracts/notes/get-note-source/response";
import { SaveNoteRequest } from "@wiki-agents/contracts/notes/save-note/request";
import { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import { UploadImageResponse } from "@wiki-agents/contracts/notes/upload-image/response";
import { deleteJson, getJson, postBytes, putJson } from "#lib/api/client.ts";

const vaultPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}`;

export const getTree = (vaultId: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/tree`, GetTreeResponse, signal);

export const getNote = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/note?path=${encodeURIComponent(path)}`, GetNoteResponse, signal);

export const getBacklinks = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/backlinks?path=${encodeURIComponent(path)}`, GetBacklinksResponse, signal);

export const getNoteSource = (vaultId: string, path: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/note/source?path=${encodeURIComponent(path)}`, GetNoteSourceResponse, signal);

/** Fails with a 409 `ApiError` when the note isn't the `baseHash` version any more. */
export const saveNote = (vaultId: string, request: SaveNoteRequest) =>
  putJson(`${vaultPath(vaultId)}/note/source`, SaveNoteRequest, request, SaveNoteResponse);

/** Adds an image to the vault's `assets/` folder; the answer says where it went. */
export const uploadImage = (vaultId: string, name: string, image: Blob) =>
  postBytes(`${vaultPath(vaultId)}/assets?name=${encodeURIComponent(name)}`, image, UploadImageResponse);

/** Moves a note to the vault's `.trash/`, if it is still the version with `hash`; 409 otherwise. */
export const deleteNote = (vaultId: string, path: string, hash: string) =>
  deleteJson(`${vaultPath(vaultId)}/note?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}`, DeleteNoteResponse);
