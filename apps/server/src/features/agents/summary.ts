import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { ProviderRegistry } from "../providers/registry.js";
import type { AgentDefinition } from "./definition.js";
import { effectiveAutonomy, WEB_NOT_A_SOURCE } from "./sources.js";

/**
 * Agents as the API shows them, with what each provider actually enforces: the
 * file's autonomy, less the web when it isn't one of the agent's sources.
 */
export const summarise = Effect.fnUntraced(function* (agents: ReadonlyArray<AgentDefinition>) {
  const registry = yield* ProviderRegistry;
  const adapters = yield* Effect.forEach(yield* registry.list, (instance) =>
    Effect.map(registry.get(instance.id), ({ adapter }) => ({ id: instance.id, adapter })),
  );
  return agents.map(({ instructions: _, ...agent }): AgentSummary => {
    const autonomy = effectiveAutonomy(agent);
    const sourceNotes = autonomy.web !== agent.autonomy.web ? [WEB_NOT_A_SOURCE] : [];
    return {
      ...agent,
      enforcement: adapters.map(({ id, adapter }) => {
        const enforced = adapter.enforcement(autonomy);
        return { providerInstanceId: id, autonomy: enforced.autonomy, notes: enforced.autonomy === null ? enforced.notes : [...sourceNotes, ...enforced.notes] };
      }),
    };
  });
});
