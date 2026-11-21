import { Data, Effect } from "effect";
import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
import type { AgentDefinition } from "../agents/definition.js";
import type { ProviderAdapter } from "../providers/port.js";

export const applicableAgentModel = (agent: AgentDefinition | null, instance: ProviderInstance): string | null =>
  agent !== null && instance.capabilities.models && (agent.provider === null || agent.provider === instance.id) ? agent.model : null;

export class UnknownModel extends Data.TaggedError("UnknownModel")<{ readonly model: string }> {}

/** Validate before creating a thread/worktree or changing an existing thread. */
export const validateModel = Effect.fn("validateModel")(function* (adapter: ProviderAdapter, cwd: string, model: string) {
  if (!adapter.capabilities.models) return yield* new UnknownModel({ model });
  const offered = yield* adapter.listModels(cwd);
  if (!offered.models.some(entry => entry.id === model)) return yield* new UnknownModel({ model });
});
