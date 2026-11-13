import { DeleteAgentResponse } from "@wiki-agents/contracts/agents/delete-agent/response";
import { DeleteRulesResponse } from "@wiki-agents/contracts/agents/delete-rules/response";
import { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { GetRulesResponse } from "@wiki-agents/contracts/agents/get-rules/response";
import { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import { SaveAgentRequest } from "@wiki-agents/contracts/agents/save-agent/request";
import { SaveAgentResponse } from "@wiki-agents/contracts/agents/save-agent/response";
import { SaveRulesRequest } from "@wiki-agents/contracts/agents/save-rules/request";
import { SaveRulesResponse } from "@wiki-agents/contracts/agents/save-rules/response";
import { ListProviderModelsResponse } from "@wiki-agents/contracts/providers/list-provider-models/response";
import { SetAgentRequest } from "@wiki-agents/contracts/threads/set-agent/request";
import { SetAgentResponse } from "@wiki-agents/contracts/threads/set-agent/response";
import { deleteJson, getJson, putJson } from "#lib/api/client.ts";

const agentPath = (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}`;
const rulesPath = (rulesId: string) => `/api/rules/${encodeURIComponent(rulesId)}`;

export const listAgents = (signal?: AbortSignal) => getJson("/api/agents", ListAgentsResponse, signal);

export const getAgent = (agentId: string, signal?: AbortSignal) => getJson(agentPath(agentId), GetAgentResponse, signal);

/** 409 when the file changed since `baseHash`; 422 with one `field: problem` per line when the loader would refuse it. */
export const saveAgent = (agentId: string, request: SaveAgentRequest) => putJson(agentPath(agentId), SaveAgentRequest, request, SaveAgentResponse);

export const deleteAgent = (agentId: string, hash: string) =>
  deleteJson(`${agentPath(agentId)}?hash=${encodeURIComponent(hash)}`, DeleteAgentResponse);

export const getRules = (rulesId: string, signal?: AbortSignal) => getJson(rulesPath(rulesId), GetRulesResponse, signal);

export const saveRules = (rulesId: string, request: SaveRulesRequest) => putJson(rulesPath(rulesId), SaveRulesRequest, request, SaveRulesResponse);

export const deleteRules = (rulesId: string, hash: string) =>
  deleteJson(`${rulesPath(rulesId)}?hash=${encodeURIComponent(hash)}`, DeleteRulesResponse);

export const listProviderModels = (providerInstanceId: string, signal?: AbortSignal) =>
  getJson(`/api/providers/${encodeURIComponent(providerInstanceId)}/models`, ListProviderModelsResponse, signal);

export const setThreadAgent = (threadId: string, agentId: string | null) =>
  putJson(`/api/threads/${encodeURIComponent(threadId)}/agent`, SetAgentRequest, { agentId }, SetAgentResponse);
