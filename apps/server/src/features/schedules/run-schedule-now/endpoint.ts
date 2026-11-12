import { RunScheduleNowRequest } from "@wiki-agents/contracts/schedules/run-schedule-now/request";
import { RunScheduleNowResponse } from "@wiki-agents/contracts/schedules/run-schedule-now/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { runScheduleNow } from "./use-case.js";

export const runScheduleNowEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(RunScheduleNowRequest);
  return yield* HttpServerResponse.schemaJson(RunScheduleNowResponse)(yield* runScheduleNow(scheduleId), { status: 202 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
    ScheduleBusy: () => Effect.succeed(conflict("A run is still going")),
  }),
  Effect.catch(internalError("run schedule now")),
);
