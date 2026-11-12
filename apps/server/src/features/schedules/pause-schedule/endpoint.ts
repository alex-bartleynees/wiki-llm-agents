import { PauseScheduleRequest } from "@wiki-agents/contracts/schedules/pause-schedule/request";
import { PauseScheduleResponse } from "@wiki-agents/contracts/schedules/pause-schedule/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { pauseSchedule } from "./use-case.js";

export const pauseScheduleEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(PauseScheduleRequest);
  const response: PauseScheduleResponse = { schedule: yield* pauseSchedule(scheduleId) };
  return yield* HttpServerResponse.schemaJson(PauseScheduleResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
    InvalidSchedule: (error) => Effect.succeed(badRequest(error.message)),
  }),
  Effect.catch(internalError("pause schedule")),
);
