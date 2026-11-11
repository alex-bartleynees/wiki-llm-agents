import { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
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

export const getDiff = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/diff`, GetDiffResponse, signal);

/** One file's diff with the larger bound, for a file cut short in the project's diff. */
export const getFileDiff = (projectId: string, directory: string, path: string, signal?: AbortSignal) =>
  getJson(`${projectPath(projectId)}/diff/file?${new URLSearchParams({ directory, path }).toString()}`, GetFileDiffResponse, signal);
