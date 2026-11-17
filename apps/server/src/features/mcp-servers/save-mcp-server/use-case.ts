import { join } from "node:path";
import type { SaveMcpServerRequest } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/request";
import type { SaveMcpServerResponse } from "@wiki-agents/contracts/mcp-servers/save-mcp-server/response";
import { Effect, Option, Result } from "effect";
import { ConfigFileInvalid, readConfigFile, requireId, writeConfigFile } from "../../../shared/config-files.js";
import { McpServerCatalog } from "../catalog.js";
import { MCP_EXTENSION, parseMcpServer } from "../definition.js";
import { mcpServerFileText } from "../server-file.js";

export interface SaveMcpServerInput extends SaveMcpServerRequest {
  readonly serverId: string;
}

/** Problems the form can show by their field, checked before the file is built. */
const formProblems = ({ server }: SaveMcpServerInput) => {
  const problems: Array<string> = [];
  if (server.title.trim() === "") problems.push("title: Give the server a name.");
  const { transport } = server;
  if (transport.type === "stdio") {
    if (transport.command.trim() === "") problems.push("transport.command: Say which command to run.");
    if (transport.cwd !== null && transport.cwd.trim() === "") problems.push("transport.cwd: Leave it unset to run in the scope's own folder.");
    if (Object.keys(transport.env).some((name) => name.trim() === "")) problems.push("transport.env: Every variable needs a name.");
  } else {
    if (transport.url.trim() === "") problems.push("transport.url: Give the server's address.");
    if (Object.keys(transport.headers).some((name) => name.trim() === "")) problems.push("transport.headers: Every header needs a name.");
  }
  return problems;
};

/**
 * Writes `mcp/<id>.yaml` from Settings: only what the loader accepts (the file is
 * built, then parsed exactly as the loader parses it), only over the version the
 * edit started from, atomically.
 */
export const saveMcpServer = Effect.fn("saveMcpServer")(function* (request: SaveMcpServerInput) {
  yield* requireId(request.serverId);
  const problems = formProblems(request);
  if (problems.length > 0) return yield* new ConfigFileInvalid({ problems });

  const { folder } = yield* (yield* McpServerCatalog).current;
  const path = join(folder, `${request.serverId}${MCP_EXTENSION}`);
  const existing = yield* readConfigFile(path);
  const text = mcpServerFileText(request.server, Option.getOrNull(existing)?.text ?? null);
  const parsed = parseMcpServer(request.serverId, path, text);
  if (Result.isFailure(parsed)) return yield* new ConfigFileInvalid({ problems: parsed.failure });

  const hash = yield* writeConfigFile(path, text, request.baseHash);
  const response: SaveMcpServerResponse = { server: parsed.success, hash };
  return response;
});
