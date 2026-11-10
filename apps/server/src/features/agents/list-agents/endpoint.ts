import { ListAgentsResponse } from "@wiki-agents/contracts/agents/list-agents/response";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { internalError } from "../../../shared/http-errors.js";
import { listAgents } from "./use-case.js";

export const listAgentsEndpoint = Effect.gen(function* () {
  return yield* HttpServerResponse.schemaJson(ListAgentsResponse)(yield* listAgents());
}).pipe(Effect.catch(internalError("list agents")));
