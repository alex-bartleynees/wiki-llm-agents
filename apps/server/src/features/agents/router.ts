import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getAgentEndpoint } from "./get-agent/endpoint.js";
import { listAgentsEndpoint } from "./list-agents/endpoint.js";

export const agentsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/agents", listAgentsEndpoint),
  HttpRouter.add("GET", "/api/agents/:agentId", getAgentEndpoint),
);
