import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { archiveProjectEndpoint } from "./archive-project/endpoint.js";
import { commitChangesEndpoint } from "./commit-changes/endpoint.js";
import { getBrowserSignInsEndpoint } from "./get-browser-sign-ins/endpoint.js";
import { getDiffEndpoint } from "./get-diff/endpoint.js";
import { getFileDiffEndpoint } from "./get-file-diff/endpoint.js";
import { getCommitMessageSettingsEndpoint } from "./get-commit-message-settings/endpoint.js";
import { getGitStatusEndpoint } from "./get-git-status/endpoint.js";
import { pushBranchEndpoint } from "./push-branch/endpoint.js";
import { ignoreFileEndpoint } from "./ignore-file/endpoint.js";
import { listChangesEndpoint } from "./list-changes/endpoint.js";
import { listProjectsEndpoint } from "./list-projects/endpoint.js";
import { listWorktreesEndpoint } from "./list-worktrees/endpoint.js";
import { registerProjectEndpoint } from "./register-project/endpoint.js";
import { restoreProjectEndpoint } from "./restore-project/endpoint.js";
import { saveBrowserSignInsEndpoint } from "./save-browser-sign-ins/endpoint.js";
import { saveCommitMessageSettingsEndpoint } from "./save-commit-message-settings/endpoint.js";
import { reviewChangesEndpoint } from "./review-changes/endpoint.js";
import { suggestCommitMessageEndpoint } from "./suggest-commit-message/endpoint.js";
import { unignoreFileEndpoint } from "./unignore-file/endpoint.js";

export const projectsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects", listProjectsEndpoint),
  HttpRouter.add("POST", "/api/projects", registerProjectEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/archive", archiveProjectEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/restore", restoreProjectEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/changes", listChangesEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/changes/review", reviewChangesEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/diff", getDiffEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/diff/file", getFileDiffEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/diff/ignored", ignoreFileEndpoint),
  HttpRouter.add("DELETE", "/api/projects/:projectId/diff/ignored", unignoreFileEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/worktrees", listWorktreesEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/git", getGitStatusEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/git/commit", commitChangesEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/git/push", pushBranchEndpoint),
  HttpRouter.add("POST", "/api/projects/:projectId/git/suggest-message", suggestCommitMessageEndpoint),
  HttpRouter.add("GET", "/api/projects/:projectId/browser-sign-ins", getBrowserSignInsEndpoint),
  HttpRouter.add("PUT", "/api/projects/:projectId/browser-sign-ins", saveBrowserSignInsEndpoint),
  HttpRouter.add("GET", "/api/commit-messages/settings", getCommitMessageSettingsEndpoint),
  HttpRouter.add("PUT", "/api/commit-messages/settings", saveCommitMessageSettingsEndpoint),
);
