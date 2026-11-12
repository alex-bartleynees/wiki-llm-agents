import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createScheduleEndpoint } from "./create-schedule/endpoint.js";
import { deleteScheduleEndpoint } from "./delete-schedule/endpoint.js";
import { getScheduleEndpoint } from "./get-schedule/endpoint.js";
import { listSchedulesEndpoint } from "./list-schedules/endpoint.js";
import { pauseScheduleEndpoint } from "./pause-schedule/endpoint.js";
import { resumeScheduleEndpoint } from "./resume-schedule/endpoint.js";
import { runScheduleNowEndpoint } from "./run-schedule-now/endpoint.js";
import { updateScheduleEndpoint } from "./update-schedule/endpoint.js";

export const schedulesRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/schedules", listSchedulesEndpoint),
  HttpRouter.add("POST", "/api/schedules", createScheduleEndpoint),
  HttpRouter.add("GET", "/api/schedules/:scheduleId", getScheduleEndpoint),
  HttpRouter.add("PATCH", "/api/schedules/:scheduleId", updateScheduleEndpoint),
  HttpRouter.add("DELETE", "/api/schedules/:scheduleId", deleteScheduleEndpoint),
  HttpRouter.add("POST", "/api/schedules/:scheduleId/pause", pauseScheduleEndpoint),
  HttpRouter.add("POST", "/api/schedules/:scheduleId/resume", resumeScheduleEndpoint),
  HttpRouter.add("POST", "/api/schedules/:scheduleId/run", runScheduleNowEndpoint),
);
