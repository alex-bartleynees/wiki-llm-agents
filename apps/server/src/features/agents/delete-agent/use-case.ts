import type { DeleteAgentRequest } from "@wiki-agents/contracts/agents/delete-agent/request";
import type { DeleteAgentResponse } from "@wiki-agents/contracts/agents/delete-agent/response";
import { Effect } from "effect";
import { AgentCatalog } from "../catalog.js";
import { requireId, trashConfigFile } from "../config-files.js";

/**
 * Moves the agent's file to the config directory's `.trash/`, if it is still the
 * version you saw. Threads using it keep their history; their next turn asks for
 * another agent, as for any missing agent.
 */
export const deleteAgent = Effect.fn("deleteAgent")(function* (request: DeleteAgentRequest) {
  yield* requireId(request.agentId);
  const catalog = yield* AgentCatalog;
  const trashPath = yield* trashConfigFile((yield* catalog.current).configDir, "agents", request.agentId, request.hash);
  yield* catalog.reload;
  return { trashPath } satisfies DeleteAgentResponse;
});
