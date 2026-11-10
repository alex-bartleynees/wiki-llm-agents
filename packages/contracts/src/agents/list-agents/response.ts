import { Schema } from "effect";
import { AgentSummary, ConfigProblem, RulesFile } from "../model.js";

export const ListAgentsResponse = Schema.Struct({
  /** Where the rules and agent files live; edit them there. */
  configDir: Schema.String,
  /** Valid agents, by name. */
  agents: Schema.Array(AgentSummary),
  rules: Schema.Array(RulesFile),
  /** Files that couldn't be loaded; an agent with a problem isn't listed in `agents`. */
  problems: Schema.Array(ConfigProblem),
});
export type ListAgentsResponse = typeof ListAgentsResponse.Type;
