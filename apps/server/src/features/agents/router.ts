import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { deleteAgentEndpoint } from "./delete-agent/endpoint.js";
import { deleteRulesEndpoint } from "./delete-rules/endpoint.js";
import { getAgentEndpoint } from "./get-agent/endpoint.js";
import { getRulesEndpoint } from "./get-rules/endpoint.js";
import { listAgentsEndpoint } from "./list-agents/endpoint.js";
import { saveAgentEndpoint } from "./save-agent/endpoint.js";
import { saveRulesEndpoint } from "./save-rules/endpoint.js";

export const agentsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/agents", listAgentsEndpoint),
  HttpRouter.add("GET", "/api/agents/:agentId", getAgentEndpoint),
  HttpRouter.add("PUT", "/api/agents/:agentId", saveAgentEndpoint),
  HttpRouter.add("DELETE", "/api/agents/:agentId", deleteAgentEndpoint),
  HttpRouter.add("GET", "/api/rules/:rulesId", getRulesEndpoint),
  HttpRouter.add("PUT", "/api/rules/:rulesId", saveRulesEndpoint),
  HttpRouter.add("DELETE", "/api/rules/:rulesId", deleteRulesEndpoint),
);
