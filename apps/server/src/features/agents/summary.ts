import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { ProviderRegistry } from "../providers/registry.js";
import type { AgentDefinition } from "./definition.js";

/** Agents as the API shows them, with what each provider actually enforces. */
export const summarise = Effect.fnUntraced(function* (agents: ReadonlyArray<AgentDefinition>) {
  const registry = yield* ProviderRegistry;
  const adapters = yield* Effect.forEach(yield* registry.list, (instance) =>
    Effect.map(registry.get(instance.id), ({ adapter }) => ({ id: instance.id, adapter })),
  );
  return agents.map(
    ({ instructions: _, ...agent }): AgentSummary => ({
      ...agent,
      enforcement: adapters.map(({ id, adapter }) => ({ providerInstanceId: id, ...adapter.enforcement(agent.autonomy) })),
    }),
  );
});
