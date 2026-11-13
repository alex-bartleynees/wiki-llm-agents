import { join } from "node:path";
import type { GetRulesRequest } from "@wiki-agents/contracts/agents/get-rules/request";
import type { GetRulesResponse } from "@wiki-agents/contracts/agents/get-rules/response";
import { Effect, Option } from "effect";
import { AgentCatalog } from "../catalog.js";
import { ConfigFileNotFound, readConfigFile, requireId } from "../config-files.js";

/** A rules file as it is on disk, with its hash for saving or deleting it. */
export const getRules = Effect.fn("getRules")(function* (request: GetRulesRequest) {
  yield* requireId(request.rulesId);
  const path = join((yield* (yield* AgentCatalog).current).configDir, "rules", `${request.rulesId}.md`);
  const file = yield* readConfigFile(path);
  if (Option.isNone(file)) return yield* new ConfigFileNotFound({ path });
  return { id: request.rulesId, path, content: file.value.text, hash: file.value.hash } satisfies GetRulesResponse;
});
