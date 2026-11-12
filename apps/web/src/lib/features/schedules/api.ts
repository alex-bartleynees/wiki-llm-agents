import { CreateScheduleRequest } from "@wiki-agents/contracts/schedules/create-schedule/request";
import { CreateScheduleResponse } from "@wiki-agents/contracts/schedules/create-schedule/response";
import { DeleteScheduleResponse } from "@wiki-agents/contracts/schedules/delete-schedule/response";
import { ListSchedulesResponse } from "@wiki-agents/contracts/schedules/list-schedules/response";
import { PauseScheduleResponse } from "@wiki-agents/contracts/schedules/pause-schedule/response";
import { ResumeScheduleResponse } from "@wiki-agents/contracts/schedules/resume-schedule/response";
import { RunScheduleNowResponse } from "@wiki-agents/contracts/schedules/run-schedule-now/response";
import { UpdateScheduleRequest } from "@wiki-agents/contracts/schedules/update-schedule/request";
import { UpdateScheduleResponse } from "@wiki-agents/contracts/schedules/update-schedule/response";
import { Schema } from "effect";
import { deleteJson, getJson, patchJson, postJson } from "#lib/api/client.ts";

const schedulePath = (scheduleId: string) => `/api/schedules/${encodeURIComponent(scheduleId)}`;
const NoBody = Schema.Struct({});

export const listSchedules = (signal?: AbortSignal) => getJson("/api/schedules", ListSchedulesResponse, signal);
export const createSchedule = (request: CreateScheduleRequest) => postJson("/api/schedules", CreateScheduleRequest, request, CreateScheduleResponse);
export const updateSchedule = (scheduleId: string, request: UpdateScheduleRequest) =>
  patchJson(schedulePath(scheduleId), UpdateScheduleRequest, request, UpdateScheduleResponse);
export const pauseSchedule = (scheduleId: string) => postJson(`${schedulePath(scheduleId)}/pause`, NoBody, {}, PauseScheduleResponse);
export const resumeSchedule = (scheduleId: string) => postJson(`${schedulePath(scheduleId)}/resume`, NoBody, {}, ResumeScheduleResponse);
export const runScheduleNow = (scheduleId: string) => postJson(`${schedulePath(scheduleId)}/run`, NoBody, {}, RunScheduleNowResponse);
export const deleteSchedule = (scheduleId: string) => deleteJson(schedulePath(scheduleId), DeleteScheduleResponse);
