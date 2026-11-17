import { gatewayToolName, gatewayToolProblem, type McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
import { Context, type Effect, type Scope } from "effect";
import type { McpSchema, McpServer } from "effect/ai";
import type { McpScopeContext } from "../mcp-servers/pool.js";

/**
 * The MCP gateway: tools of the servers in `mcp/*.yaml` (the coffee journal, GitHub...),
 * given to threads on their own `/mcp` entry as `<server>__<tool>` and called through
 * the connection pool. Providers see one entry per thread whatever the servers, and
 * never a secret.
 *
 * Each upstream tool is registered on `/mcp` once, by name, behind a visibility check:
 * a thread sees the tools of its last `prepare`, and nothing else.
 */
export interface McpGatewayService {
  /**
   * Works out the thread's tools for its next turn: the servers given to every thread
   * plus `agentServers`, each server's read-only tools whose names fit. A server that is
   * down or slow leaves out only its own tools. Says what was left out, and why.
   */
  readonly prepare: (context: McpScopeContext, agentServers: ReadonlyArray<string>) => Effect.Effect<ThreadTools>;
  /** Hides every gateway tool from the thread (its actor closed). */
  readonly release: (threadId: string) => Effect.Effect<void>;
  /** Called by `/mcp` once it is built: tools are registered on `server` from then on, including those prepared before. */
  readonly attach: (server: McpServer.McpServer["Service"]) => Effect.Effect<void, never, Scope.Scope>;
}

export class McpGateway extends Context.Service<McpGateway, McpGatewayService>()("McpGateway") {}

export interface ThreadTools {
  /** `<server>__<tool>` names, sorted. */
  readonly names: ReadonlyArray<string>;
  /**
   * Starts at 0 and goes up by one each time the thread's set of tools changes, so
   * providers can register the entry again: they don't list tools again otherwise.
   */
  readonly revision: number;
  /** For the user: servers down or missing, tools held back. */
  readonly notices: ReadonlyArray<string>;
}

/** An upstream tool as threads get it. */
export interface GatewayTool {
  /** `<server>__<tool>`. */
  readonly name: string;
  readonly serverId: string;
  readonly serverTitle: string;
  /** The server's own description of it, with its own name. */
  readonly tool: McpSchema.Tool;
}

/** The servers a thread gets: those for every thread and those its agent lists; and the listed ones that don't exist. */
export const serversFor = (servers: ReadonlyArray<McpServerSummary>, agentServers: ReadonlyArray<string>) => ({
  chosen: servers.filter((server) => server.default || agentServers.includes(server.id)),
  missing: agentServers.filter((id) => !servers.some((server) => server.id === id)),
});

/** A server's tools split into those threads get and those held back, with why. */
export const toolsOf = (server: Pick<McpServerSummary, "id" | "title">, tools: ReadonlyArray<McpSchema.Tool>) => {
  const given: Array<GatewayTool> = [];
  const heldBack: Array<{ readonly name: string; readonly problem: string }> = [];
  for (const tool of tools) {
    const problem = gatewayToolProblem(server.id, { name: tool.name, readOnly: tool.annotations?.readOnlyHint === true });
    if (problem === null) given.push({ name: gatewayToolName(server.id, tool.name), serverId: server.id, serverTitle: server.title, tool });
    else heldBack.push({ name: tool.name, problem });
  }
  return { given, heldBack };
};

/** One notice per reason: `GitHub: create_issue and merge_pr aren't given to agents. They may change things…`. */
export const heldBackNotices = (title: string, heldBack: ReadonlyArray<{ readonly name: string; readonly problem: string }>): ReadonlyArray<string> => {
  const byProblem = new Map<string, Array<string>>();
  for (const { name, problem } of heldBack) byProblem.set(problem, [...(byProblem.get(problem) ?? []), name]);
  return [...byProblem].map(([problem, names]) => `${title}: ${listed(names)} ${names.length === 1 ? "isn't" : "aren't"} given to agents. ${problem}`);
};

const listed = (names: ReadonlyArray<string>) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What agents are shown for a tool; a change to any of it means registering the entry again. */
export const descriptorOf = (tool: GatewayTool) => ({
  name: tool.name,
  title: tool.tool.title ?? tool.tool.annotations?.title,
  description: `${tool.serverTitle} (MCP server ${tool.serverId}): ${tool.tool.description ?? tool.tool.name}`,
  inputSchema: tool.tool.inputSchema,
  outputSchema: tool.tool.outputSchema,
  annotations: tool.tool.annotations,
});

/** Identifies a set of tools as agents see them. */
export const fingerprintOf = (tools: ReadonlyArray<GatewayTool>) => JSON.stringify([...tools].sort((a, b) => a.name.localeCompare(b.name)).map(descriptorOf));
