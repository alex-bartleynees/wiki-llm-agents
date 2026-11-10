import { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { ListProjectsResponse } from "@wiki-agents/contracts/projects/list-projects/response";
import { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { Schema } from "effect";
import { getJson, postJson } from "#lib/api/client.ts";

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const NoBody = Schema.Struct({});

export const listProjects = (signal?: AbortSignal) => getJson("/api/projects", ListProjectsResponse, signal);

export const registerProject = (body: RegisterProjectRequest) => postJson("/api/projects", RegisterProjectRequest, body, RegisterProjectResponse);

export const listChanges = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/changes`, ListChangesResponse, signal);

export const reviewChanges = (projectId: string) => postJson(`${projectPath(projectId)}/changes/review`, NoBody, {}, ReviewChangesResponse);
