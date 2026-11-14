import type { EventTopic } from "@wiki-agents/contracts/events/model";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { AnswerRequestRequest } from "@wiki-agents/contracts/threads/answer-request/request";
import { AnswerRequestResponse } from "@wiki-agents/contracts/threads/answer-request/response";
import { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { InterruptTurnResponse } from "@wiki-agents/contracts/threads/interrupt-turn/response";
import { ListActiveThreadsResponse } from "@wiki-agents/contracts/threads/list-active-threads/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { MarkDoneResponse } from "@wiki-agents/contracts/threads/mark-done/response";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { ReopenThreadResponse } from "@wiki-agents/contracts/threads/reopen-thread/response";
import { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { SetModelRequest } from "@wiki-agents/contracts/threads/set-model/request";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Schema } from "effect";
import { getJson, postJson, putJson } from "#lib/api/client.ts";

const vaultThreadsPath = (vaultId: string) => `/api/vaults/${encodeURIComponent(vaultId)}/threads`;
const threadPath = (threadId: string) => `/api/threads/${encodeURIComponent(threadId)}`;
const NoBody = Schema.Struct({});

/** Threads working, waiting for you, or stopped, in every vault. */
export const listActiveThreads = (signal?: AbortSignal) => getJson("/api/active-threads", ListActiveThreadsResponse, signal);

/** Every thread's changes, in every vault, on the event stream (`ThreadsStreamMessage`). */
export const ALL_THREADS_TOPIC: EventTopic = { type: "all-threads" };

export const listProviders = (signal?: AbortSignal) => getJson("/api/providers", ListProvidersResponse, signal);

/** One project's threads, or (for a null `projectId`) every thread in the vault. */
export const listThreads = (vaultId: string, projectId: string | null, signal?: AbortSignal) =>
  getJson(vaultThreadsPath(vaultId) + (projectId === null ? "" : `?projectId=${encodeURIComponent(projectId)}`), ListThreadsResponse, signal);

export const getProviderStatus = (providerInstanceId: string, signal?: AbortSignal) =>
  getJson(`/api/providers/${encodeURIComponent(providerInstanceId)}/status`, GetProviderStatusResponse, signal);

export const createThread = (vaultId: string, options: { readonly projectId?: string; readonly providerInstanceId?: string; readonly agentId?: string }) =>
  postJson(
    vaultThreadsPath(vaultId),
    CreateThreadRequest,
    {
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.providerInstanceId === undefined ? {} : { providerInstanceId: options.providerInstanceId }),
      ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    },
    CreateThreadResponse,
  );

export const listModels = (threadId: string, signal?: AbortSignal) => getJson(`${threadPath(threadId)}/models`, ListModelsResponse, signal);

export const setModel = (threadId: string, model: string) => putJson(`${threadPath(threadId)}/model`, SetModelRequest, { model }, SetModelResponse);

export const getThread = (threadId: string, signal?: AbortSignal) => getJson(threadPath(threadId), GetThreadResponse, signal);

export const sendMessage = (threadId: string, text: string, notes: SendMessageRequest["notes"] = []) =>
  postJson(`${threadPath(threadId)}/messages`, SendMessageRequest, { text, notes }, SendMessageResponse);

export const interruptTurn = (threadId: string) => postJson(`${threadPath(threadId)}/interrupt`, NoBody, {}, InterruptTurnResponse);

/** Moves the thread to the Done group; 409 while a turn runs or waits for you. */
export const markDone = (threadId: string) => postJson(`${threadPath(threadId)}/done`, NoBody, {}, MarkDoneResponse);

export const reopenThread = (threadId: string) => postJson(`${threadPath(threadId)}/reopen`, NoBody, {}, ReopenThreadResponse);

export const answerRequest = (threadId: string, requestId: string, answer: RequestAnswer) =>
  postJson(`${threadPath(threadId)}/requests/${encodeURIComponent(requestId)}`, AnswerRequestRequest, { answer }, AnswerRequestResponse);

/** Topics on the event stream; see `lib/api/sse.ts`. A thread's events after seq `after` (`ThreadStreamMessage`). */
export const threadTopic = (threadId: string, after: number): EventTopic => ({ type: "thread", threadId, after });
/** A vault's thread list (`ThreadsStreamMessage`). */
export const vaultThreadsTopic = (vaultId: string): EventTopic => ({ type: "vault-threads", vaultId });
