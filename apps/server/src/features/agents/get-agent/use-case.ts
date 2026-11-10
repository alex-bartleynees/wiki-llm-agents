import type { GetAgentRequest } from "@wiki-agents/contracts/agents/get-agent/request";
import type { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { Effect } from "effect";
import { AgentCatalog } from "../catalog.js";
import { summarise } from "../summary.js";

export const getAgent = Effect.fn("getAgent")(function* (request: GetAgentRequest) {
  const agent = yield* (yield* AgentCatalog).get(request.agentId);
  const [summary] = yield* summarise([agent]);
  const response: GetAgentResponse = { agent: summary!, instructions: agent.instructions };
  return response;
});
