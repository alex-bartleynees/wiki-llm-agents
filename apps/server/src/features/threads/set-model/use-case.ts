import type { SetModelRequest } from "@wiki-agents/contracts/threads/set-model/request";
import type { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Effect } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { findVault } from "../../vaults/find-vault.js";
import { validateModel } from "../model-selection.js";
import { findThread } from "../find-thread.js";
import { ThreadActors } from "../thread-actors.js";

/** Checks the model is one the provider offers, then has the thread's actor switch to it. */
export const setModel = Effect.fn("setModel")(function* (request: SetModelRequest & { readonly threadId: string }) {
  const thread = yield* findThread(request.threadId);
  const { adapter } = yield* (yield* ProviderRegistry).get(thread.providerInstanceId);
  yield* validateModel(adapter, (yield* findVault(thread.vaultId)).rootPath, request.model);
  const response: SetModelResponse = { thread: yield* (yield* ThreadActors).setModel(thread.id, request.model) };
  return response;
});
