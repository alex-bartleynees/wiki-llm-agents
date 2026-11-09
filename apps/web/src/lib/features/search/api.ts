import { ListTagsResponse } from "@wiki-agents/contracts/search/list-tags/response";
import { QuickSwitchResponse } from "@wiki-agents/contracts/search/quick-switch/response";
import { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { getJson } from "#lib/api/client.ts";

const vaultPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}`;

export const searchNotes = (
  vaultId: string,
  query: { readonly text: string; readonly tags: ReadonlyArray<string> },
  signal?: AbortSignal,
) => {
  const params = new URLSearchParams();
  if (query.text.trim() !== "") params.set("q", query.text);
  if (query.tags.length > 0) params.set("tags", query.tags.join(","));
  return getJson(`${vaultPath(vaultId)}/search?${params}`, SearchNotesResponse, signal);
};

export const quickSwitch = (vaultId: string, q: string, signal?: AbortSignal) =>
  getJson(`${vaultPath(vaultId)}/quick-switch?q=${encodeURIComponent(q)}`, QuickSwitchResponse, signal);

export const listTags = (vaultId: string, signal?: AbortSignal) => getJson(`${vaultPath(vaultId)}/tags`, ListTagsResponse, signal);
