import type { DeleteRulesRequest } from "@wiki-agents/contracts/agents/delete-rules/request";
import type { DeleteRulesResponse } from "@wiki-agents/contracts/agents/delete-rules/response";
import { Effect } from "effect";
import { AgentCatalog } from "../catalog.js";
import { requireId, trashConfigFile } from "../config-files.js";

/** Moves a rules file to the config directory's `.trash/`, if it is still the version you saw. */
export const deleteRules = Effect.fn("deleteRules")(function* (request: DeleteRulesRequest) {
  yield* requireId(request.rulesId);
  const catalog = yield* AgentCatalog;
  const trashPath = yield* trashConfigFile((yield* catalog.current).configDir, "rules", request.rulesId, request.hash);
  yield* catalog.reload;
  return { trashPath } satisfies DeleteRulesResponse;
});
