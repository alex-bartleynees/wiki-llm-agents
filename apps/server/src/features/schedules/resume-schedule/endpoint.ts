import { ResumeScheduleRequest } from "@wiki-agents/contracts/schedules/resume-schedule/request";
import { ResumeScheduleResponse } from "@wiki-agents/contracts/schedules/resume-schedule/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { resumeSchedule } from "./use-case.js";

export const resumeScheduleEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(ResumeScheduleRequest);
  const response: ResumeScheduleResponse = { schedule: yield* resumeSchedule(scheduleId) };
  return yield* HttpServerResponse.schemaJson(ResumeScheduleResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
    InvalidSchedule: (error) => Effect.succeed(badRequest(error.message)),
  }),
  Effect.catch(internalError("resume schedule")),
);
