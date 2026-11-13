import { join } from "node:path";
import type { GetAgentRequest } from "@wiki-agents/contracts/agents/get-agent/request";
import type { GetAgentResponse } from "@wiki-agents/contracts/agents/get-agent/response";
import { Effect, Option, Result } from "effect";
import { AgentCatalog, AgentNotFound } from "../catalog.js";
import { readConfigFile } from "../config-files.js";
import { ID_PATTERN, parseAgent } from "../definition.js";
import { summarise } from "../summary.js";

/**
 * The agent as its file is on disk now, with the file's hash for saving or deleting
 * it, so what the editor shows and the hash it saves against always match.
 */
export const getAgent = Effect.fn("getAgent")(function* (request: GetAgentRequest) {
  const { configDir } = yield* (yield* AgentCatalog).current;
  if (!ID_PATTERN.test(request.agentId)) return yield* new AgentNotFound({ agentId: request.agentId, problem: null });
  const path = join(configDir, "agents", `${request.agentId}.md`);
  const file = yield* readConfigFile(path).pipe(Effect.catchTag("ConfigFileInvalid", (error) => Effect.fail(new AgentNotFound({ agentId: request.agentId, problem: error.problems.join(" ") }))));
  if (Option.isNone(file)) return yield* new AgentNotFound({ agentId: request.agentId, problem: null });
  const parsed = parseAgent(request.agentId, path, file.value.text);
  if (Result.isFailure(parsed)) return yield* new AgentNotFound({ agentId: request.agentId, problem: parsed.failure.join(" ") });
  const [summary] = yield* summarise([parsed.success]);
  const response: GetAgentResponse = { agent: summary!, instructions: parsed.success.instructions, hash: file.value.hash };
  return response;
});
