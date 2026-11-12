import { DeleteScheduleRequest } from "@wiki-agents/contracts/schedules/delete-schedule/request";
import { DeleteScheduleResponse } from "@wiki-agents/contracts/schedules/delete-schedule/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { deleteSchedule } from "./use-case.js";

export const deleteScheduleEndpoint = Effect.gen(function* () {
  const { scheduleId } = yield* HttpRouter.schemaPathParams(DeleteScheduleRequest);
  const response: DeleteScheduleResponse = { scheduleId: yield* deleteSchedule(scheduleId) };
  return yield* HttpServerResponse.schemaJson(DeleteScheduleResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ScheduleNotFound: () => Effect.succeed(notFound("Schedule not found")),
  }),
  Effect.catch(internalError("delete schedule")),
);
