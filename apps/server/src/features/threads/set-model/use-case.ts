import type { SetModelRequest } from "@wiki-agents/contracts/threads/set-model/request";
import type { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Data, Effect } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { findVault } from "../../vaults/find-vault.js";
import { findThread } from "../find-thread.js";
import { ThreadActors } from "../thread-actors.js";

/** The provider doesn't offer this model (or offers no choice of model). */
export class UnknownModel extends Data.TaggedError("UnknownModel")<{ readonly model: string }> {}

/** Checks the model is one the provider offers, then has the thread's actor switch to it. */
export const setModel = Effect.fn("setModel")(function* (request: SetModelRequest & { readonly threadId: string }) {
  const thread = yield* findThread(request.threadId);
  const { adapter } = yield* (yield* ProviderRegistry).get(thread.providerInstanceId);
  if (!adapter.capabilities.models) return yield* new UnknownModel({ model: request.model });
  const { models } = yield* adapter.listModels((yield* findVault(thread.vaultId)).rootPath);
  if (!models.some((model) => model.id === request.model)) return yield* new UnknownModel({ model: request.model });
  const response: SetModelResponse = { thread: yield* (yield* ThreadActors).setModel(thread.id, request.model) };
  return response;
});
