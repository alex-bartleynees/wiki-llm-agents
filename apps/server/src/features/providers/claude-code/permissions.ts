import { dirname, isAbsolute, resolve } from "node:path";
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem } from "effect";
import { commandNamesProtected, type Protection, reachesProtected } from "../../../shared/secret-paths.js";
import { pathsWithinRoots } from "../../../shared/vault/path-scope.js";
import { ENTRY_PREFIX, serverDecides } from "../../mcp/vault-tools.js";

/**
 * Claude Code's tools per autonomy action. Its own permission rules (and any allow
 * rules in your Claude Code settings) are overruled by the app's `PreToolUse` hook,
 * which answers every tool call from these lists; "ask" reaches the app as an
 * approval through `canUseTool`.
 */
export const TOOLS = {
  read: ["Read", "Glob", "Grep", "LS", "LSP", "NotebookRead", "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool"],
  /** `Write` creates a file when it doesn't exist yet; the others change one. */
  write: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
  commands: ["Bash", "PowerShell", "Monitor"],
  web: ["WebFetch", "WebSearch"],
  /** Starting a subagent (`Agent`, `Task` in older versions); its own tool calls come through the same hook. */
  subagents: ["Agent", "Task"],
} as const;

/** Tools that change nothing and only plan, track work, or load instructions: always allowed. */
export const HARMLESS_TOOLS = ["TodoWrite", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "Skill", "ToolSearch", "WaitForMcpServers"] as const;

/** Claude Code's name for an MCP server's tool: `mcp__<server>__<tool>`. */
export const mcpPrefix = (server: string) => `mcp__${server}__`;

const STRICTNESS: Readonly<Record<AutonomyLevel, number>> = { allow: 0, ask: 1, deny: 2 };
const strictest = (a: AutonomyLevel, b: AutonomyLevel) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

const has = (list: ReadonlyArray<string>, name: string) => list.includes(name);

const field = (input: unknown, key: string): string | undefined => {
  if (typeof input !== "object" || input === null || !(key in input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

/** Glob characters: a pattern's folder is the part before the first one. */
const GLOB = /[*?[\]{}]/;

/** The files or folders a file tool reaches; relative paths are from `cwd`. */
export const toolPaths = (toolName: string, input: unknown, cwd: string): ReadonlyArray<string> => {
  const path = field(input, "file_path") ?? field(input, "notebook_path") ?? field(input, "path");
  const paths = [resolve(cwd, path ?? ".")];
  const pattern = field(input, "pattern");
  if (toolName === "Glob" && pattern !== undefined && isAbsolute(pattern)) {
    const glob = pattern.search(GLOB);
    paths.push(glob === -1 ? pattern : dirname(`${pattern.slice(0, glob)}x`));
  }
  return paths;
};

/** The file a writing tool writes, as an absolute path. */
export const writeTarget = (toolName: string, input: unknown, cwd: string): string | undefined => {
  if (!has(TOOLS.write, toolName)) return undefined;
  const path = field(input, "file_path") ?? field(input, "notebook_path");
  return path === undefined ? undefined : resolve(cwd, path);
};

export interface DecisionInput {
  readonly autonomy: Autonomy;
  /** Canonical folders the agent may reach without asking (the working folder; a project's directories and vault). */
  readonly roots: ReadonlyArray<string>;
  /** Canonical folders the agent may also read, but not write, without asking (the thread's own attachments). */
  readonly readable: ReadonlyArray<string>;
  /** What is protected: denied to every tool whatever the autonomy (see `SessionSetup.protection`). */
  readonly protection: Protection;
  readonly cwd: string;
  /** The thread's vault tools MCP server; null when it has none. */
  readonly vaultTools: string | null;
  readonly toolName: string;
  readonly toolInput: unknown;
}

/**
 * What the hook answers for a tool call: allow, ask or deny, `defer` to leave it
 * to Claude Code's own permission rules, or `secret`: denied because it reaches a
 * file holding secrets.
 */
export type Decision = AutonomyLevel | "defer" | "secret";

/** Tools that search a folder: a folder holding a secret counts as reaching it. */
const SEARCHES = ["Glob", "Grep", "LS"];

/**
 * Allow, ask or deny one tool call, from the agent's autonomy. Files outside `roots`
 * ask (or stay denied), whatever the autonomy says, except reading in `readable`.
 * `Write` to a file that doesn't
 * exist yet is creating; any other write is editing. Tools this doesn't know ask,
 * as do `AskUserQuestion` (it is how a question reaches you) and other MCP servers'
 * tools; other threads' vault tools are denied. A file tool reaching a protected path
 * or name (`.env`), or a command naming one, is `secret` before anything else (naming
 * is a best effort: a command can reach a file without naming it).
 *
 * Claude Code finds and searches files with shell commands (it has no Glob or Grep).
 * While commands ask and reading is allowed, commands are left to Claude Code, which
 * runs the ones it judges read-only inside the working folders without asking and
 * asks (through `canUseTool`) for the rest.
 */
export const decide = Effect.fnUntraced(function* (input: DecisionInput): Effect.fn.Return<Decision, never, FileSystem.FileSystem> {
  const { autonomy, toolName, toolInput, cwd } = input;
  if (has(HARMLESS_TOOLS, toolName)) return "allow" as const;
  if (input.vaultTools !== null && toolName.startsWith(mcpPrefix(input.vaultTools))) {
    return serverDecides(toolName.slice(mcpPrefix(input.vaultTools).length)) ? "allow" : autonomy.read;
  }
  if (toolName.startsWith(`mcp__${ENTRY_PREFIX}`)) return "deny" as const;
  if (has(TOOLS.commands, toolName) && commandNamesProtected(input.protection, field(toolInput, "command") ?? "")) return "secret" as const;
  if (has(TOOLS.commands, toolName)) return autonomy.commands === "ask" && autonomy.read === "allow" ? "defer" : autonomy.commands;
  if (has(TOOLS.web, toolName)) return autonomy.web;
  if (has(TOOLS.subagents, toolName)) return autonomy.subagents;
  const reads = has(TOOLS.read, toolName);
  const target = writeTarget(toolName, toolInput, cwd);
  const reached = reads ? toolPaths(toolName, toolInput, cwd) : target === undefined ? [] : [target];
  if (yield* reachesProtected(input.protection, cwd, reached, { searches: SEARCHES.includes(toolName) })) return "secret" as const;
  if (!reads && target === undefined) return "ask" as const;
  const fs = yield* FileSystem.FileSystem;
  const level = reads ? autonomy.read : toolName === "Write" && !(yield* fs.exists(target!).pipe(Effect.orElseSucceed(() => true))) ? autonomy.create : autonomy.edit;
  if (level === "deny") return level;
  const inside = reads
    ? yield* pathsWithinRoots([...input.roots, ...input.readable], cwd, toolPaths(toolName, toolInput, cwd))
    : yield* pathsWithinRoots(input.roots, cwd, [target!]);
  return inside ? level : strictest(level, "ask");
});

/** What Claude Code enforces for `autonomy`, with notes where it differs from the file. */
export const enforcedAutonomy = (autonomy: Autonomy) => ({
  autonomy,
  notes: [
    "Anything outside the working folder asks first, whatever the autonomy says, except reading the thread's own attachments.",
    ...(autonomy.commands === "ask"
      ? ["Claude Code lists and searches files with shell commands; it runs the ones it judges read-only (ls, find, grep...) without asking, and allow rules in your Claude Code settings apply to commands."]
      : []),
  ],
});
