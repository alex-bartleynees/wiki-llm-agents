import type { AgentSummary, ConfigProblem, RulesFile } from "@wiki-agents/contracts/agents/model";
import { errorMessage } from "#lib/api/client.ts";
import { listAgents } from "./api.ts";

const CHOSEN_KEY = "wiki-agents:agent";

const stored = () => {
  try {
    return localStorage.getItem(CHOSEN_KEY);
  } catch {
    return null;
  }
};

/**
 * The agents in the app's config directory, and the one new threads use
 * (remembered on this device; none until you pick one). The server reloads the
 * files when they change; `refresh` asks again, e.g. when the Agents screen opens.
 */
class AgentsStore {
  list = $state<ReadonlyArray<AgentSummary>>([]);
  rules = $state<ReadonlyArray<RulesFile>>([]);
  problems = $state<ReadonlyArray<ConfigProblem>>([]);
  configDir = $state<string | null>(null);
  error = $state<string | undefined>(undefined);
  /** The agent shown in detail on the Agents screen. */
  shown = $state<string | null>(null);
  #chosen = $state<string | null>(stored());
  #loading: Promise<void> | undefined;

  /** Loads once; later calls share the first. */
  load() {
    this.#loading ??= this.refresh();
    return this.#loading;
  }

  async refresh() {
    try {
      const response = await listAgents();
      this.list = response.agents;
      this.rules = response.rules;
      this.problems = response.problems;
      this.configDir = response.configDir;
      this.error = undefined;
    } catch (error) {
      this.#loading = undefined;
      this.error = errorMessage(error, "Couldn't load the agents");
    }
  }

  get(id: string | null | undefined) {
    return id == null ? undefined : this.list.find((agent) => agent.id === id);
  }

  /** The agent for new threads, if it still exists. */
  get chosen(): AgentSummary | undefined {
    return this.get(this.#chosen);
  }

  choose(id: string | null) {
    this.#chosen = id;
    try {
      if (id === null) localStorage.removeItem(CHOSEN_KEY);
      else localStorage.setItem(CHOSEN_KEY, id);
    } catch {
      // Not remembered; the choice still holds for this page.
    }
  }
}

export const agents = new AgentsStore();
