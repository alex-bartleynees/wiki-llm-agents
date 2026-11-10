import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { AnswerRequestRequest } from "@wiki-agents/contracts/threads/answer-request/request";
import { AnswerRequestResponse } from "@wiki-agents/contracts/threads/answer-request/response";
import { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { InterruptTurnResponse } from "@wiki-agents/contracts/threads/interrupt-turn/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { SetModelRequest } from "@wiki-agents/contracts/threads/set-model/request";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Schema } from "effect";
import { getJson, postJson, putJson } from "#lib/api/client.ts";

const vaultThreadsPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}/threads`;
const threadPath = (threadId: string) => `/api/threads/${encodeURIComponent(threadId)}`;
const NoBody = Schema.Struct({});

export const listProviders = (signal?: AbortSignal) => getJson("/api/providers", ListProvidersResponse, signal);

export const listThreads = (vaultId: string, signal?: AbortSignal) => getJson(vaultThreadsPath(vaultId), ListThreadsResponse, signal);

export const getProviderStatus = (providerInstanceId: string, signal?: AbortSignal) =>
  getJson(`/api/providers/${encodeURIComponent(providerInstanceId)}/status`, GetProviderStatusResponse, signal);

export const createThread = (vaultId: string, providerInstanceId?: string) =>
  postJson(vaultThreadsPath(vaultId), CreateThreadRequest, providerInstanceId === undefined ? {} : { providerInstanceId }, CreateThreadResponse);

export const listModels = (threadId: string, signal?: AbortSignal) => getJson(`${threadPath(threadId)}/models`, ListModelsResponse, signal);

export const setModel = (threadId: string, model: string) => putJson(`${threadPath(threadId)}/model`, SetModelRequest, { model }, SetModelResponse);

export const getThread = (threadId: string, signal?: AbortSignal) => getJson(threadPath(threadId), GetThreadResponse, signal);

export const sendMessage = (threadId: string, text: string) =>
  postJson(`${threadPath(threadId)}/messages`, SendMessageRequest, { text }, SendMessageResponse);

export const interruptTurn = (threadId: string) => postJson(`${threadPath(threadId)}/interrupt`, NoBody, {}, InterruptTurnResponse);

export const answerRequest = (threadId: string, requestId: string, answer: RequestAnswer) =>
  postJson(`${threadPath(threadId)}/requests/${encodeURIComponent(requestId)}`, AnswerRequestRequest, { answer }, AnswerRequestResponse);

/** SSE paths; see `lib/api/sse.ts`. */
export const threadEventsPath = (threadId: string, after: number) => `/events/threads/${encodeURIComponent(threadId)}?after=${after}`;
export const vaultThreadsEventsPath = (vaultId: string) => `/events/vaults/${encodeURIComponent(vaultId)}/threads`;
