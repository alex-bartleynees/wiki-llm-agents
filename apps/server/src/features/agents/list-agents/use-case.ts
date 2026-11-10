import type { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import { Effect } from "effect";
import { AgentCatalog } from "../catalog.js";
import { summarise } from "../summary.js";

export const listAgents = Effect.fn("listAgents")(function* () {
  const config = yield* (yield* AgentCatalog).current;
  const response: ListAgentsResponse = {
    configDir: config.configDir,
    agents: yield* summarise(config.agents),
    rules: config.rules.map(({ id, path }) => ({ id, path })),
    problems: config.problems,
  };
  return response;
});
