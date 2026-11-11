import { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { ListProjectsResponse } from "@wiki-agents/contracts/projects/list-projects/response";
import { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { RestoreProjectResponse } from "@wiki-agents/contracts/projects/restore-project/response";
import { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { Schema } from "effect";
import { getJson, postJson } from "#lib/api/client.ts";

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const NoBody = Schema.Struct({});
/** Registering and marking reviewed read every file once; a large repository takes a while. */
const SCAN = { timeoutMs: 5 * 60_000 };

export const listProjects = (signal?: AbortSignal) => getJson("/api/projects", ListProjectsResponse, signal);

export const registerProject = (body: RegisterProjectRequest) => postJson("/api/projects", RegisterProjectRequest, body, RegisterProjectResponse, SCAN);

export const archiveProject = (projectId: string) => postJson(`${projectPath(projectId)}/archive`, NoBody, {}, ArchiveProjectResponse);

export const restoreProject = (projectId: string) => postJson(`${projectPath(projectId)}/restore`, NoBody, {}, RestoreProjectResponse);

export const listChanges = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/changes`, ListChangesResponse, signal);

export const reviewChanges = (projectId: string) => postJson(`${projectPath(projectId)}/changes/review`, NoBody, {}, ReviewChangesResponse, SCAN);
