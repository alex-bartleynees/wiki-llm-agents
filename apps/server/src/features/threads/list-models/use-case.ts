import type { ListModelsRequest } from "@wiki-agents/contracts/threads/list-models/request";
import type { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import { Effect } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { findThread } from "../find-thread.js";
import { threadWorkspace } from "../workspace.js";

/** The models of the thread's provider in the thread's working directory. */
export const listModels = Effect.fn("listModels")(function* (request: ListModelsRequest) {
  const thread = yield* findThread(request.threadId);
  const { adapter } = yield* (yield* ProviderRegistry).get(thread.providerInstanceId);
  if (!adapter.capabilities.models) return { models: [], current: null } satisfies ListModelsResponse;
  const { cwd } = yield* threadWorkspace(thread);
  const { models, defaultModel } = yield* adapter.listModels(cwd);
  const response: ListModelsResponse = { models, current: thread.model ?? defaultModel };
  return response;
});
