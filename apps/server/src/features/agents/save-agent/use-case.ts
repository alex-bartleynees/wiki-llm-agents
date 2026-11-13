import { join } from "node:path";
import type { SaveAgentRequest } from "@wiki-agents/contracts/agents/save-agent/request";
import type { SaveAgentResponse } from "@wiki-agents/contracts/agents/save-agent/response";
import { Effect, Option, Result } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { agentFileText } from "../agent-file.js";
import { AgentCatalog } from "../catalog.js";
import { ConfigFileInvalid, readConfigFile, requireId, writeConfigFile } from "../config-files.js";
import { parseAgent } from "../definition.js";
import { summarise } from "../summary.js";

export interface SaveAgentInput extends SaveAgentRequest {
  readonly agentId: string;
}

/** Problems the file format can't name a field for, checked first so the form can show them by their field. */
const formProblems = (request: SaveAgentInput, providers: ReadonlyArray<string>) => {
  const { agent } = request;
  const problems: Array<string> = [];
  if (agent.name.trim() === "") problems.push("name: Give the agent a name.");
  if (agent.instructions.trim() === "") problems.push("instructions: Write what the agent should do.");
  if (agent.provider !== null && !providers.includes(agent.provider)) problems.push(`provider: There is no provider "${agent.provider}".`);
  if (agent.model !== null && agent.model.trim() === "") problems.push("model: Leave it unset for the provider's default.");
  for (const source of agent.sources) {
    if (typeof source !== "string" && source.vault.trim() === "") problems.push("sources: Pick a vault.");
  }
  return problems;
};

/**
 * Writes `agents/<id>.md` from the editor: only what the loader accepts (the file
 * is built, then parsed exactly as the loader parses it), only over the version
 * the edit started from, atomically. The catalog reloads before answering, so the
 * next turn of every thread using the agent gets the new version.
 */
export const saveAgent = Effect.fn("saveAgent")(function* (request: SaveAgentInput) {
  yield* requireId(request.agentId);
  const providers = (yield* (yield* ProviderRegistry).list).map((instance) => instance.id);
  const problems = formProblems(request, providers);
  if (problems.length > 0) return yield* new ConfigFileInvalid({ problems });

  const catalog = yield* AgentCatalog;
  const { configDir } = yield* catalog.current;
  const path = join(configDir, "agents", `${request.agentId}.md`);
  const existing = yield* readConfigFile(path);
  const text = agentFileText(request.agent, Option.getOrNull(existing)?.text ?? null);
  const parsed = parseAgent(request.agentId, path, text);
  if (Result.isFailure(parsed)) return yield* new ConfigFileInvalid({ problems: parsed.failure });

  const hash = yield* writeConfigFile(path, text, request.baseHash);
  yield* catalog.reload;
  const [summary] = yield* summarise([parsed.success]);
  const response: SaveAgentResponse = { agent: summary!, instructions: parsed.success.instructions, hash };
  return response;
});
