import { DeleteMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/delete-mcp-server/response";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import { SaveMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/request";
import { SaveMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/response";
import { deleteJson, getJson, putJson } from "#lib/api/client.ts";

const serverPath = (serverId: string) => `/api/mcp-servers/${encodeURIComponent(serverId)}`;

export const listMcpServers = (signal?: AbortSignal) => getJson("/api/mcp-servers", ListMcpServersResponse, signal);

export const getMcpServer = (serverId: string, signal?: AbortSignal) => getJson(serverPath(serverId), GetMcpServerResponse, signal);

/** 409 when the file changed since `baseHash`; 422 with one `field: problem` per line when the loader would refuse it. */
export const saveMcpServer = (serverId: string, request: SaveMcpServerRequest) =>
  putJson(serverPath(serverId), SaveMcpServerRequest, request, SaveMcpServerResponse);

export const deleteMcpServer = (serverId: string, hash: string) =>
  deleteJson(`${serverPath(serverId)}?hash=${encodeURIComponent(hash)}`, DeleteMcpServerResponse);
