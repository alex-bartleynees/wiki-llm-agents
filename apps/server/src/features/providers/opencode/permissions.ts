import { homedir } from "node:os";
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { spellings } from "../../../shared/secret-paths.js";
import { ENTRY_PREFIX, GATEWAY_TOOL_PATTERN, VAULT_WRITE_TOOLS } from "../../mcp/vault-tools.js";
import type { OpenCodePermissionRule } from "./api.js";

/**
 * OpenCode's permission actions per autonomy action. Actions are tool names, and
 * the command tool is `shell` (OpenCode 2.2's config schema still says `bash`).
 * Writing a new file and changing one are both `edit`.
 */
export const ACTIONS = {
  read: ["read", "glob", "grep", "list", "lsp"],
  edit: ["edit", "write", "patch"],
  commands: ["shell"],
  web: ["webfetch", "websearch", "browser"],
} as const;

/** Actions that read or write files: their resources are paths. */
export const FILE_ACTIONS: ReadonlyArray<string> = [...ACTIONS.read, ...ACTIONS.edit];

/** Actions that search a folder: one holding a protected path reaches it. */
export const SEARCH_ACTIONS: ReadonlyArray<string> = ["glob", "grep", "list"];

/** Tools that change nothing and only talk to you or plan: always allowed. */
export const HARMLESS_ACTIONS = ["question", "todowrite", "todo", "skill"] as const;

const STRICTNESS: Readonly<Record<AutonomyLevel, number>> = { allow: 0, ask: 1, deny: 2 };

const strictest = (a: AutonomyLevel, b: AutonomyLevel) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/** OpenCode can't tell creating a file from editing one, so both get the stricter level. */
const fileWrites = (autonomy: Autonomy) => strictest(autonomy.create, autonomy.edit);

/**
 * OpenCode's permission action for an MCP server's tools: `<server>_<tool>`, with
 * anything outside `[A-Za-z0-9_-]` replaced by `_` in both parts.
 */
export const mcpToolAction = (server: string, tool: string) => `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}_${tool}`;
export const mcpToolsAction = (server: string) => mcpToolAction(server, "*");

/**
 * Autonomy as OpenCode session rules. OpenCode applies the last rule that matches,
 * so the catch-all `ask` comes first: anything not listed (files outside the
 * working directory, subagents, MCP tools, tools this list doesn't know) asks.
 * Only `allow` and `deny` need rules of their own.
 *
 * The thread's own attachment folders may be reached without asking (OpenCode asks
 * `external_directory` with `<folder>/*` before any tool works outside the session's
 * folder), so reading there follows `read`; writes there name the absolute file and
 * still ask, or stay denied. Checked live with OpenCode 2.2.6.
 *
 * Paths holding secrets come last, so nothing overrides them: every file action and
 * `external_directory` on them is denied, and so is a shell command naming one (a
 * best effort; the adapter also refuses any request that reaches one).
 */
export const permissionRules = (
  autonomy: Autonomy,
  vaultTools: string | null = null,
  attachmentFolders: ReadonlyArray<string> = [],
  protectedPaths: ReadonlyArray<string> = [],
  home: string = homedir(),
): ReadonlyArray<OpenCodePermissionRule> => {
  const levels: ReadonlyArray<readonly [ReadonlyArray<string>, AutonomyLevel]> = [
    [HARMLESS_ACTIONS, "allow"],
    [ACTIONS.read, autonomy.read],
    [ACTIONS.edit, fileWrites(autonomy)],
    [ACTIONS.commands, autonomy.commands],
    [ACTIONS.web, autonomy.web],
  ];
  return [
    { action: "*", resource: "*", effect: "ask" },
    ...levels.flatMap(([actions, level]) => (level === "ask" ? [] : actions.map((action) => ({ action, resource: "*", effect: level }) as const))),
    // Every thread in a folder sees every thread's vault tools entry; use only your own.
    { action: `${ENTRY_PREFIX}*`, resource: "*", effect: "deny" },
    // The vault tools read the vault (and open notes in the app), so they follow `read`.
    ...(vaultTools === null ? [] : [
      { action: mcpToolsAction(vaultTools), resource: "*", effect: autonomy.read } as const,
      // The MCP server owns write approvals (see VAULT_WRITE_TOOLS) and other servers' tools (isGatewayTool).
      ...[...VAULT_WRITE_TOOLS, GATEWAY_TOOL_PATTERN].map((tool) => ({ action: mcpToolAction(vaultTools, tool), resource: "*", effect: "allow" } as const)),
    ]),
    ...attachmentFolders.flatMap((folder) => [
      { action: "external_directory", resource: `${folder}/*`, effect: "allow" } as const,
      ...ACTIONS.edit.map((action) => ({ action, resource: `${folder}/*`, effect: strictest(fileWrites(autonomy), "ask") }) as const),
    ]),
    ...protectedPaths.flatMap((path) => [
      ...[...FILE_ACTIONS, "external_directory"].flatMap((action) => [path, `${path}/*`].map((resource) => ({ action, resource, effect: "deny" }) as const)),
      ...spellings(path, home).map((spelling) => ({ action: "shell", resource: `*${spelling}*`, effect: "deny" }) as const),
    ]),
  ];
};

const LEVEL_WORD: Readonly<Record<AutonomyLevel, string>> = { allow: "are allowed", ask: "ask first", deny: "are denied" };

/** What OpenCode enforces for `autonomy`, with notes where it differs from the file. */
export const enforcedAutonomy = (autonomy: Autonomy) => {
  const writes = fileWrites(autonomy);
  const notes: Array<string> = [];
  if (autonomy.create !== autonomy.edit) {
    notes.push(`OpenCode can't tell creating a file from editing one, so both ${LEVEL_WORD[writes]}.`);
  }
  notes.push("Anything outside the working folder asks first, whatever the autonomy says, except reading the thread's own attachments.");
  return { autonomy: { ...autonomy, create: writes, edit: writes }, notes };
};

/** OpenCode's wildcard match: `*` is any characters (slashes too), `?` one; the whole string must match. */
const wildcard = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`, "s").test(value);

/**
 * What OpenCode decides for an action on a resource under `rules`: the last rule
 * matching both wins, and nothing matching asks. The app leaves deciding to OpenCode;
 * this says what it will decide, for tests and the tests' fake OpenCode. Checked live
 * with OpenCode 2.2.6 for `external_directory` and `edit` on attachment folders.
 */
export const ruleEffect = (rules: ReadonlyArray<OpenCodePermissionRule>, action: string, resource: string): AutonomyLevel =>
  rules.findLast((rule) => wildcard(rule.action, action) && wildcard(rule.resource, resource))?.effect ?? "ask";
