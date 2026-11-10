import { randomUUID } from "node:crypto";
import type { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import type { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Clock, Effect } from "effect";
import { AgentCatalog } from "../../agents/catalog.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { findVault } from "../../vaults/find-vault.js";
import { ThreadRepository } from "../repository.js";
import { ThreadBus } from "../thread-bus.js";

/**
 * The provider is the request's, else the agent's, else the default. The agent's
 * model is used when the thread runs on the agent's own provider (or the agent
 * names none).
 */
export const createThread = Effect.fn("createThread")(function* (request: CreateThreadRequest & { readonly vaultId: string }) {
  const vault = yield* findVault(request.vaultId);
  const agent = request.agentId === undefined ? null : yield* (yield* AgentCatalog).get(request.agentId);
  const registry = yield* ProviderRegistry;
  const providerInstanceId = request.providerInstanceId ?? agent?.provider ?? undefined;
  const instance = providerInstanceId === undefined ? yield* registry.defaultInstance : (yield* registry.get(providerInstanceId)).instance;
  const agentsProvider = agent !== null && (agent.provider === null || agent.provider === instance.id);
  const thread = yield* (yield* ThreadRepository).insert({
    id: randomUUID(),
    vaultId: vault.id,
    providerInstanceId: instance.id,
    agentId: agent?.id ?? null,
    model: agentsProvider && instance.capabilities.models ? agent.model : null,
    createdAt: yield* Clock.currentTimeMillis,
  });
  yield* (yield* ThreadBus).publishThread(thread);
  const response: CreateThreadResponse = { thread };
  return response;
});
