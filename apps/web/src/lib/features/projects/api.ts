import { CheckWorktreeBranchResponse } from "@wiki-agents/contracts/projects/check-worktree-branch/response";
import { DeleteWorktreeBranchRequest } from "@wiki-agents/contracts/projects/delete-worktree-branch/request";
import { DeleteWorktreeBranchResponse } from "@wiki-agents/contracts/projects/delete-worktree-branch/response";
import { AddWorkingDirectoryRequest } from "@wiki-agents/contracts/projects/add-working-directory/request";
import { AddWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/add-working-directory/response";
import { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { RemoveWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/remove-working-directory/response";
import { CommitChangesRequest } from "@wiki-agents/contracts/projects/commit-changes/request";
import { CommitChangesResponse } from "@wiki-agents/contracts/projects/commit-changes/response";
import { GetBrowserSignInsResponse } from "@wiki-agents/contracts/projects/get-browser-sign-ins/response";
import { SaveBrowserSignInsRequest } from "@wiki-agents/contracts/projects/save-browser-sign-ins/request";
import { SaveBrowserSignInsResponse } from "@wiki-agents/contracts/projects/save-browser-sign-ins/response";
import { GetProjectMcpServersResponse } from "@wiki-agents/contracts/projects/get-project-mcp-servers/response";
import { SaveProjectMcpServersRequest } from "@wiki-agents/contracts/projects/save-project-mcp-servers/request";
import { SaveProjectMcpServersResponse } from "@wiki-agents/contracts/projects/save-project-mcp-servers/response";
import { GetCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/get-commit-message-settings/response";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { GetGitStatusResponse } from "@wiki-agents/contracts/projects/get-git-status/response";
import { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
import { IgnoreFileRequest } from "@wiki-agents/contracts/projects/ignore-file/request";
import { IgnoreFileResponse } from "@wiki-agents/contracts/projects/ignore-file/response";
import { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { ListProjectsResponse } from "@wiki-agents/contracts/projects/list-projects/response";
import { ListWorktreesResponse } from "@wiki-agents/contracts/projects/list-worktrees/response";
import { PushBranchRequest } from "@wiki-agents/contracts/projects/push-branch/request";
import { PushBranchResponse } from "@wiki-agents/contracts/projects/push-branch/response";
import { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { RestoreProjectResponse } from "@wiki-agents/contracts/projects/restore-project/response";
import { SaveCommitMessageSettingsRequest } from "@wiki-agents/contracts/projects/save-commit-message-settings/request";
import { SaveCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/save-commit-message-settings/response";
import { SuggestCommitMessageRequest } from "@wiki-agents/contracts/projects/suggest-commit-message/request";
import { SuggestCommitMessageResponse } from "@wiki-agents/contracts/projects/suggest-commit-message/response";
import { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { UnignoreFileResponse } from "@wiki-agents/contracts/projects/unignore-file/response";
import { Schema } from "effect";
import { deleteJson, getJson, postJson, putJson } from "#lib/api/client.ts";

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const NoBody = Schema.Struct({});
/** Registering and marking reviewed read every file once; a large repository takes a while. */
const SCAN = { timeoutMs: 5 * 60_000 };

export const listProjects = (signal?: AbortSignal) => getJson("/api/projects", ListProjectsResponse, signal);

export const registerProject = (body: RegisterProjectRequest) => postJson("/api/projects", RegisterProjectRequest, body, RegisterProjectResponse, SCAN);

export const archiveProject = (projectId: string) => postJson(`${projectPath(projectId)}/archive`, NoBody, {}, ArchiveProjectResponse);

export const restoreProject = (projectId: string) => postJson(`${projectPath(projectId)}/restore`, NoBody, {}, RestoreProjectResponse);

export const addWorkingDirectory = (projectId: string, path: string) =>
  postJson(`${projectPath(projectId)}/working-directories`, AddWorkingDirectoryRequest, { path }, AddWorkingDirectoryResponse, SCAN);

export const removeWorkingDirectory = (projectId: string, path: string) =>
  deleteJson(`${projectPath(projectId)}/working-directories?${new URLSearchParams({ path }).toString()}`, RemoveWorkingDirectoryResponse);

export const listChanges =(projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/changes`, ListChangesResponse, signal);

export const reviewChanges = (projectId: string) => postJson(`${projectPath(projectId)}/changes/review`, NoBody, {}, ReviewChangesResponse, SCAN);

export const getDiff = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/diff`, GetDiffResponse, signal);

/** One file's diff with the larger bound, for a file cut short in the project's diff. */
export const getFileDiff = (projectId: string, directory: string, path: string, signal?: AbortSignal) =>
  getJson(`${projectPath(projectId)}/diff/file?${new URLSearchParams({ directory, path }).toString()}`, GetFileDiffResponse, signal);

/** Sets a file aside in the project's diff review, on every device. */
export const ignoreFile = (projectId: string, directory: string, path: string) =>
  postJson(`${projectPath(projectId)}/diff/ignored`, IgnoreFileRequest, { directory, path }, IgnoreFileResponse);

/** Brings an ignored file back into the project's diff review. */
export const unignoreFile = (projectId: string, directory: string, path: string) =>
  deleteJson(`${projectPath(projectId)}/diff/ignored?${new URLSearchParams({ directory, path }).toString()}`, UnignoreFileResponse);

/** The project's thread worktrees and whether new threads can have one. */
export const listWorktrees = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/worktrees`, ListWorktreesResponse, signal);

/** Each git directory's branch, upstream and ahead/behind (as of the last fetch). */
export const getGitStatus = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/git`, GetGitStatusResponse, signal);

/** Commit hooks may run tests: wait as long as the server lets them. */
const COMMIT = { timeoutMs: 5 * 60_000 + 15_000 };
/** The server stops a push after 90 s. */
const PUSH = { timeoutMs: 105_000 };

/** Commits exactly the ticked files as reviewed; 409 when anything moved since, or a hook refused. */
export const commitChanges = (projectId: string, body: CommitChangesRequest) =>
  postJson(`${projectPath(projectId)}/git/commit`, CommitChangesRequest, body, CommitChangesResponse, COMMIT);

/** Pushes the checked-out branch to its upstream (or, with `setUpstream`, sets one); never forced. */
export const pushBranch = (projectId: string, body: PushBranchRequest) =>
  postJson(`${projectPath(projectId)}/git/push`, PushBranchRequest, body, PushBranchResponse, PUSH);

/** A model's answer takes a while; the server gives up after two minutes. */
const SUGGEST = { timeoutMs: 135_000 };

/** A commit message for the ticked files from the provider chosen in Settings; never commits. */
export const suggestCommitMessage = (projectId: string, body: SuggestCommitMessageRequest) =>
  postJson(`${projectPath(projectId)}/git/suggest-message`, SuggestCommitMessageRequest, body, SuggestCommitMessageResponse, SUGGEST);

/** Which provider and model suggest commit messages, and what that resolves to now. */
export const getCommitMessageSettings = (signal?: AbortSignal) => getJson("/api/commit-messages/settings", GetCommitMessageSettingsResponse, signal);

export const saveCommitMessageSettings = (body: SaveCommitMessageSettingsRequest) =>
  putJson("/api/commit-messages/settings", SaveCommitMessageSettingsRequest, body, SaveCommitMessageSettingsResponse);

/** The project's browser sign-ins: names, sites and secret names, never a value. */
export const getBrowserSignIns = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/browser-sign-ins`, GetBrowserSignInsResponse, signal);

/** Replaces the project's browser sign-ins; 400 lists what to fix. */
export const saveBrowserSignIns = (projectId: string, body: SaveBrowserSignInsRequest) =>
  putJson(`${projectPath(projectId)}/browser-sign-ins`, SaveBrowserSignInsRequest, body, SaveBrowserSignInsResponse);

/** The MCP servers every thread in the project gets, whatever its agent. */
export const getProjectMcpServers = (projectId: string, signal?: AbortSignal) => getJson(`${projectPath(projectId)}/mcp-servers`, GetProjectMcpServersResponse, signal);

/** Replaces the project's MCP servers; 400 lists what to fix. */
export const saveProjectMcpServers = (projectId: string, body: SaveProjectMcpServersRequest) =>
  putJson(`${projectPath(projectId)}/mcp-servers`, SaveProjectMcpServersRequest, body, SaveProjectMcpServersResponse);

const worktreeBranchPath = (projectId: string, threadId: string) => `${projectPath(projectId)}/worktrees/${encodeURIComponent(threadId)}/branch`;
const BRANCH_CLEANUP_TIMEOUT = { timeoutMs: 65_000 };

export const checkWorktreeBranch = (projectId: string, threadId: string) =>
  postJson(`${worktreeBranchPath(projectId, threadId)}/check`, NoBody, {}, CheckWorktreeBranchResponse, BRANCH_CLEANUP_TIMEOUT);

export const deleteWorktreeBranch = (projectId: string, threadId: string, confirmation: string) =>
  postJson(`${worktreeBranchPath(projectId, threadId)}/delete`, DeleteWorktreeBranchRequest, { confirmation }, DeleteWorktreeBranchResponse, BRANCH_CLEANUP_TIMEOUT);
