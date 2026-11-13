import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";

/** What a scheduled prompt's run will use when its Model field is left empty. */
export type ModelSource = {
  /** The provider whose models to suggest; undefined when there is none to ask. */
  readonly provider: ProviderInstance | undefined;
  /** The agent's own model, used when the field is empty and the agent sets one. */
  readonly agentModel: string | null;
};

/**
 * The provider a run uses, resolved as the server does when it creates the run's
 * thread (`createThread`): the schedule's provider, else the agent's, else the first
 * configured one. The agent's model applies when the run is on the agent's own
 * provider (or the agent names none) and that provider offers a choice of models.
 */
export const modelSource = (
  providerInstanceId: string,
  agent: AgentSummary | undefined,
  providers: ReadonlyArray<ProviderInstance>,
): ModelSource => {
  const id = providerInstanceId !== "" ? providerInstanceId : (agent?.provider ?? providers[0]?.id);
  const provider = providers.find((candidate) => candidate.id === id);
  const agentsProvider = agent !== undefined && (agent.provider === null || agent.provider === provider?.id);
  const agentModel = agentsProvider && provider?.capabilities.models === true ? agent.model : null;
  return { provider, agentModel };
};

/** The Model field's placeholder: what an empty field means for this run. */
export const modelPlaceholder = (source: ModelSource, defaultModel: string | null): string => {
  if (source.agentModel !== null) return `The agent's (${source.agentModel})`;
  if (source.provider === undefined) return "The provider's default";
  if (!source.provider.capabilities.models) return `${source.provider.name} has no model choice`;
  return `${source.provider.name}'s default${defaultModel ? ` (${defaultModel})` : ""}`;
};
