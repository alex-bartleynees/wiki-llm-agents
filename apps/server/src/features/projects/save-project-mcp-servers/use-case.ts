import { projectMcpServerProblems } from "@wiki-agents/contracts/projects/model";
import type { SaveProjectMcpServersRequest } from "@wiki-agents/contracts/projects/save-project-mcp-servers/request";
import type { SaveProjectMcpServersResponse } from "@wiki-agents/contracts/projects/save-project-mcp-servers/response";
import { Effect } from "effect";
import { InvalidProject } from "../errors.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/**
 * Replaces the project's MCP servers: ids trimmed, blanks dropped, each once. Ids are
 * checked for form only; one not in Settings › MCP servers is reported to its threads
 * each turn, as an agent's would be.
 */
export const saveProjectMcpServers = Effect.fn("saveProjectMcpServers")(function* (projectId: string, request: SaveProjectMcpServersRequest) {
  const project = yield* findProject(projectId);
  const serverIds = [...new Set(request.serverIds.map((id) => id.trim()).filter((id) => id !== ""))];
  const problems = projectMcpServerProblems(serverIds);
  if (problems.length > 0) return yield* new InvalidProject({ message: problems.join("\n") });
  const repository = yield* ProjectRepository;
  yield* repository.saveMcpServers(project.id, serverIds);
  return { serverIds: yield* repository.mcpServers(project.id) } satisfies SaveProjectMcpServersResponse;
});
