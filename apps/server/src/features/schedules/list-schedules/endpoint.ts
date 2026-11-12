import { ListSchedulesRequest } from "@wiki-agents/contracts/schedules/list-schedules/request";
import { ListSchedulesResponse } from "@wiki-agents/contracts/schedules/list-schedules/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { listSchedules } from "./use-case.js";

export const listSchedulesEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListSchedulesRequest);
  return yield* HttpServerResponse.schemaJson(ListSchedulesResponse)(yield* listSchedules());
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("list schedules")),
);
