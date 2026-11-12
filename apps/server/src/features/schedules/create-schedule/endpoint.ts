import { CreateScheduleRequest } from "@wiki-agents/contracts/schedules/create-schedule/request";
import { CreateScheduleResponse } from "@wiki-agents/contracts/schedules/create-schedule/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError } from "../../../shared/http-errors.js";
import { createSchedule } from "./use-case.js";

export const createScheduleEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(CreateScheduleRequest);
  const response: CreateScheduleResponse = { schedule: yield* createSchedule(request) };
  return yield* HttpServerResponse.schemaJson(CreateScheduleResponse)(response, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidSchedule: (error) => Effect.succeed(badRequest(error.message)),
    VaultNotFound: () => Effect.succeed(badRequest("Unknown vault")),
    ProjectNotFound: () => Effect.succeed(badRequest("Unknown project")),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProviderInstanceNotFound: () => Effect.succeed(badRequest("Unknown provider")),
    AgentNotFound: (error) => Effect.succeed(badRequest(error.reason)),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("create schedule")),
);
