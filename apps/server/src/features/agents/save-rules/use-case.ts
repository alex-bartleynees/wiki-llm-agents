import { join } from "node:path";
import type { SaveRulesRequest } from "@wiki-agents/contracts/agents/save-rules/request";
import type { SaveRulesResponse } from "@wiki-agents/contracts/agents/save-rules/response";
import { Effect, Result } from "effect";
import { AgentCatalog } from "../catalog.js";
import { ConfigFileInvalid, requireId, writeConfigFile } from "../config-files.js";
import { MAX_FILE_BYTES, parseRules } from "../definition.js";

export interface SaveRulesInput extends SaveRulesRequest {
  readonly rulesId: string;
}

/**
 * Writes `rules/<id>.md` as typed, if the loader would accept it and the file is
 * still the version the edit started from. Every agent gets it from its next turn.
 */
export const saveRules = Effect.fn("saveRules")(function* (request: SaveRulesInput) {
  yield* requireId(request.rulesId);
  const catalog = yield* AgentCatalog;
  const path = join((yield* catalog.current).configDir, "rules", `${request.rulesId}.md`);
  if (new TextEncoder().encode(request.content).length > MAX_FILE_BYTES) {
    return yield* new ConfigFileInvalid({ problems: [`content: Over ${MAX_FILE_BYTES / 1024} KiB; rules that long crowd out the conversation.`] });
  }
  const parsed = parseRules(request.rulesId, path, request.content);
  if (Result.isFailure(parsed)) return yield* new ConfigFileInvalid({ problems: parsed.failure.map((problem) => `content: ${problem}`) });
  const hash = yield* writeConfigFile(path, request.content, request.baseHash);
  yield* catalog.reload;
  return { id: request.rulesId, path, hash } satisfies SaveRulesResponse;
});
