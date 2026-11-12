import { GetScheduleRequest } from "@wiki-agents/contracts/schedules/get-schedule/request";
import { GetScheduleResponse } from "@wiki-agents/contracts/schedules/get-schedule/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { showSchedule } from "../find-schedule.js";
import { DETAIL_RUNS } from "../present.js";

export const getScheduleEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(GetScheduleRequest);
  const response: GetScheduleResponse = { schedule: yield* showSchedule(scheduleId, DETAIL_RUNS) };
  return yield* HttpServerResponse.schemaJson(GetScheduleResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
  }),
  Effect.catch(internalError("get schedule")),
);
