import { randomUUID } from "node:crypto";
import type { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import type { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Clock, Effect } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadRepository } from "../repository.js";
import { ThreadBus } from "../thread-bus.js";

export const createThread = Effect.fn("createThread")(function* (request: CreateThreadRequest & { readonly vaultId: string }) {
  const vault = yield* findVault(request.vaultId);
  const registry = yield* ProviderRegistry;
  const instance =
    request.providerInstanceId === undefined
      ? yield* registry.defaultInstance
      : (yield* registry.get(request.providerInstanceId)).instance;
  const thread = yield* (yield* ThreadRepository).insert({
    id: randomUUID(),
    vaultId: vault.id,
    providerInstanceId: instance.id,
    createdAt: yield* Clock.currentTimeMillis,
  });
  yield* (yield* ThreadBus).publishThread(thread);
  const response: CreateThreadResponse = { thread };
  return response;
});
