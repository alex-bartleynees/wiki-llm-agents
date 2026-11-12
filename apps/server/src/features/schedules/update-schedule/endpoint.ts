import { UpdateScheduleParams, UpdateScheduleRequest } from "@wiki-agents/contracts/schedules/update-schedule/request";
import { UpdateScheduleResponse } from "@wiki-agents/contracts/schedules/update-schedule/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { updateSchedule } from "./use-case.js";

export const updateScheduleEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(UpdateScheduleParams);
  const request = yield* HttpServerRequest.schemaBodyJson(UpdateScheduleRequest);
  const response: UpdateScheduleResponse = { schedule: yield* updateSchedule(scheduleId, request) };
  return yield* HttpServerResponse.schemaJson(UpdateScheduleResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
    InvalidSchedule: (error) => Effect.succeed(badRequest(error.message)),
    VaultNotFound: () => Effect.succeed(badRequest("Unknown vault")),
    ProjectNotFound: () => Effect.succeed(badRequest("Unknown project")),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProviderInstanceNotFound: () => Effect.succeed(badRequest("Unknown provider")),
    AgentNotFound: (error) => Effect.succeed(badRequest(error.reason)),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("update schedule")),
);
