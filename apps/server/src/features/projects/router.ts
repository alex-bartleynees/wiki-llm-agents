import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { archiveProjectEndpoint } from "./archive-project/endpoint.js";
import { getDiffEndpoint } from "./get-diff/endpoint.js";
import { getFileDiffEndpoint } from "./get-file-diff/endpoint.js";
import { ignoreFileEndpoint } from "./ignore-file/endpoint.js";
import { listChangesEndpoint } from "./list-changes/endpoint.js";
import { listProjectsEndpoint } from "./list-projects/endpoint.js";
import { registerProjectEndpoint } from "./register-project/endpoint.js";
import { restoreProjectEndpoint } from "./restore-project/endpoint.js";
import { reviewChangesEndpoint } from "./review-changes/endpoint.js";
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
);
