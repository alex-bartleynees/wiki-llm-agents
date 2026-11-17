import { DeleteMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/delete-mcp-server/response";
import { GetMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/get-mcp-server/response";
import { ListMcpServersResponse } from "@wiki-agents/contracts/mcp-servers/list-mcp-servers/response";
import { SaveMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/request";
import { SaveMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/response";
import { DisconnectResponse } from "@wiki-agents/contracts/mcp-oauth/disconnect/response";
import { FinishConnectRequest } from "@wiki-agents/contracts/mcp-oauth/finish-connect/request";
import { FinishConnectResponse } from "@wiki-agents/contracts/mcp-oauth/finish-connect/response";
import { ListConnectionsResponse } from "@wiki-agents/contracts/mcp-oauth/list-connections/response";
import { StartConnectResponse } from "@wiki-agents/contracts/mcp-oauth/start-connect/response";
import { Schema } from "effect";
import { deleteJson, getJson, postJson, putJson } from "#lib/api/client.ts";

const serverPath = (serverId: string) => `/api/mcp-servers/${encodeURIComponent(serverId)}`;

export const listMcpServers = (signal?: AbortSignal) => getJson("/api/mcp-servers", ListMcpServersResponse, signal);

export const getMcpServer = (serverId: string, signal?: AbortSignal) => getJson(serverPath(serverId), GetMcpServerResponse, signal);

/** 409 when the file changed since `baseHash`; 422 with one `field: problem` per line when the loader would refuse it. */
export const saveMcpServer = (serverId: string, request: SaveMcpServerRequest) =>
  putJson(serverPath(serverId), SaveMcpServerRequest, request, SaveMcpServerResponse);

export const deleteMcpServer = (serverId: string, hash: string) =>
  deleteJson(`${serverPath(serverId)}?hash=${encodeURIComponent(hash)}`, DeleteMcpServerResponse);

const NoBody = Schema.Struct({});

/** Each sign-in-able server's state; never a token. */
export const listConnections = (signal?: AbortSignal) => getJson("/api/mcp-servers/oauth/connections", ListConnectionsResponse, signal);

/** The identity server's sign-in page; 409 with the reason when the server can't be signed in to. Discovery and registration can take a while. */
export const startConnect = (serverId: string) => postJson(`${serverPath(serverId)}/connect`, NoBody, {}, StartConnectResponse, { timeoutMs: 60_000 });

/** Finishes a sign-in from the address the identity server sent you to, pasted. */
export const finishConnect = (url: string) => postJson("/api/mcp-servers/oauth/finish", FinishConnectRequest, { url }, FinishConnectResponse, { timeoutMs: 30_000 });

export const disconnect = (serverId: string) => deleteJson(`${serverPath(serverId)}/connection`, DisconnectResponse);
