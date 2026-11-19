import { GetDraftResponse } from "@wiki-agents/contracts/threads/get-draft/response";
import { SaveDraftRequest } from "@wiki-agents/contracts/threads/save-draft/request";
import { SaveDraftResponse } from "@wiki-agents/contracts/threads/save-draft/response";
import type { EventTopic } from "@wiki-agents/contracts/events/model";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { AnswerRequestRequest } from "@wiki-agents/contracts/threads/answer-request/request";
import { AnswerRequestResponse } from "@wiki-agents/contracts/threads/answer-request/response";
import { CompactContextRequest } from "@wiki-agents/contracts/threads/compact-context/request";
import { CompactContextResponse } from "@wiki-agents/contracts/threads/compact-context/response";
import { ContinueThreadRequest } from "@wiki-agents/contracts/threads/continue-thread/request";
import { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import { RequestHandoffRequest } from "@wiki-agents/contracts/threads/request-handoff/request";
import { RequestHandoffResponse } from "@wiki-agents/contracts/threads/request-handoff/response";
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
import { RemoveWorktreeResponse } from "@wiki-agents/contracts/threads/remove-worktree/response";
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

export interface NewThreadOptions {
  readonly model?: string;
  readonly projectId?: string;
  readonly providerInstanceId?: string;
  readonly agentId?: string;
  /** Run it in its own git worktree on this new branch. */
  readonly worktreeBranch?: string;
}

export const createThread = (vaultId: string, options: NewThreadOptions) =>
  postJson(
    vaultThreadsPath(vaultId),
    CreateThreadRequest,
    {
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.providerInstanceId === undefined ? {} : { providerInstanceId: options.providerInstanceId }),
      ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
      ...(options.worktreeBranch === undefined ? {} : { worktree: { branch: options.worktreeBranch } }),
    },
    CreateThreadResponse,
  );

export const listModels = (threadId: string, signal?: AbortSignal) => getJson(`${threadPath(threadId)}/models`, ListModelsResponse, signal);

export const setModel = (threadId: string, model: string) => putJson(`${threadPath(threadId)}/model`, SetModelRequest, { model }, SetModelResponse);

export const getThread = (threadId: string, signal?: AbortSignal) => getJson(threadPath(threadId), GetThreadResponse, signal);

/** Files sent with a message: attachment ids, and whether its images go as files. */
export type MessageFiles = Pick<SendMessageRequest, "attachments" | "imagesAsFiles">;

export const sendMessage = (threadId: string, text: string, notes: SendMessageRequest["notes"] = [], files: MessageFiles = {}) =>
  postJson(`${threadPath(threadId)}/messages`, SendMessageRequest, { text, notes, ...files }, SendMessageResponse);

export const interruptTurn = (threadId: string) => postJson(`${threadPath(threadId)}/interrupt`, NoBody, {}, InterruptTurnResponse);

/**
 * Compact conversation: the provider summarises the conversation in its own session.
 * The same `operationId` again (a retry) never compacts twice; 409 while busy, or
 * when the provider can't or there is nothing to compact.
 */
export const compactContext = (threadId: string, operationId: string) =>
  postJson(`${threadPath(threadId)}/compact`, CompactContextRequest, { operationId }, CompactContextResponse);

/**
 * Asks the thread's agent for a handoff, as a turn of its own in this thread (it uses
 * some of your usage). The same `operationId` again never asks twice; 409 while busy,
 * or when there is nothing to hand off yet.
 */
export const requestHandoff = (threadId: string, operationId: string) =>
  postJson(`${threadPath(threadId)}/handoff`, RequestHandoffRequest, { operationId }, RequestHandoffResponse);

/** A new thread continuing this one, with a fresh provider session and `text` as its draft. */
export const continueThread = (threadId: string, request: ContinueThreadRequest) =>
  postJson(`${threadPath(threadId)}/continue`, ContinueThreadRequest, request, ContinueThreadResponse);

/** Moves the thread to the Done group; 409 while a turn runs or waits for you. */
export const markDone = (threadId: string) => postJson(`${threadPath(threadId)}/done`, NoBody, {}, MarkDoneResponse);

export const reopenThread = (threadId: string) => postJson(`${threadPath(threadId)}/reopen`, NoBody, {}, ReopenThreadResponse);

export const answerRequest = (threadId: string, requestId: string, answer: RequestAnswer) =>
  postJson(`${threadPath(threadId)}/requests/${encodeURIComponent(requestId)}`, AnswerRequestRequest, { answer }, AnswerRequestResponse);

/** Topics on the event stream; see `lib/api/sse.ts`. A thread's events after seq `after` (`ThreadStreamMessage`). */
export const threadTopic = (threadId: string, after: number): EventTopic => ({ type: "thread", threadId, after });
/** A vault's thread list (`ThreadsStreamMessage`). */
export const vaultThreadsTopic = (vaultId: string): EventTopic => ({ type: "vault-threads", vaultId });

export const getDraft = (threadId: string) => getJson(`${threadPath(threadId)}/draft`, GetDraftResponse);

export const saveDraft = (threadId: string, request: SaveDraftRequest) =>
  putJson(`${threadPath(threadId)}/draft`, SaveDraftRequest, request, SaveDraftResponse, {
    // Fetch limits keepalive bodies to 64 KiB. Large drafts still save while the page is open.
    keepalive: new TextEncoder().encode(JSON.stringify(request)).byteLength < 60_000,
  });

/** `git worktree remove` for the thread's worktree; 409 with git's refusal, or while a turn runs or waits. */
export const removeWorktree = (threadId: string) => postJson(`${threadPath(threadId)}/worktree/remove`, NoBody, {}, RemoveWorktreeResponse);
