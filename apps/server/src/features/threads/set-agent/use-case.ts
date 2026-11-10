import type { SetAgentRequest } from "@wiki-agents/contracts/threads/set-agent/request";
import type { SetAgentResponse } from "@wiki-agents/contracts/threads/set-agent/response";
import { Effect } from "effect";
import { AgentCatalog } from "../../agents/catalog.js";
import { findThread } from "../find-thread.js";
import { ThreadActors } from "../thread-actors.js";

/**
 * Checks the agent exists and loads, then has the thread's actor switch to it. The
 * provider stays the thread's; the agent's instructions and autonomy apply from
 * the next turn, even one sent while a turn runs.
 */
export const setAgent = Effect.fn("setAgent")(function* (request: SetAgentRequest & { readonly threadId: string }) {
  const thread = yield* findThread(request.threadId);
  if (request.agentId !== null) yield* (yield* AgentCatalog).get(request.agentId);
  const response: SetAgentResponse = { thread: yield* (yield* ThreadActors).setAgent(thread.id, request.agentId) };
  return response;
});
