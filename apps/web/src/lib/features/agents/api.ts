import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import { SetAgentRequest } from "@wiki-agents/contracts/threads/set-agent/request";
import { SetAgentResponse } from "@wiki-agents/contracts/threads/set-agent/response";
import { getJson, putJson } from "#lib/api/client.ts";

export const listAgents = (signal?: AbortSignal) => getJson("/api/agents", ListAgentsResponse, signal);

export const getAgent = (agentId: string, signal?: AbortSignal) => getJson(`/api/agents/${encodeURIComponent(agentId)}`, GetAgentResponse, signal);

export const setThreadAgent = (threadId: string, agentId: string | null) =>
  putJson(`/api/threads/${encodeURIComponent(threadId)}/agent`, SetAgentRequest, { agentId }, SetAgentResponse);
