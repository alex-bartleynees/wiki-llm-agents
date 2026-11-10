import { ListFoldersResponse } from "@wiki-agents/contracts/folders/list-folders/response";
import { getJson } from "#lib/api/client.ts";
import type { FolderListing } from "#lib/ui/primitives/FolderPicker.svelte";

export const listFolders = (path: string | null, signal?: AbortSignal) =>
  getJson(path === null ? "/api/folders" : `/api/folders?path=${encodeURIComponent(path)}`, ListFoldersResponse, signal);

/** Folders on the server's machine, for a folder picker; starts at the home folder. */
export const machineFolders = async (path: string | null): Promise<FolderListing> => {
  const listing = await listFolders(path);
  return { ...listing, label: listing.path };
};
