import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
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

/** Tools that change nothing and only talk to you or plan: always allowed. */
export const HARMLESS_ACTIONS = ["question", "todowrite", "todo", "skill"] as const;

const STRICTNESS: Readonly<Record<AutonomyLevel, number>> = { allow: 0, ask: 1, deny: 2 };

const strictest = (a: AutonomyLevel, b: AutonomyLevel) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/** OpenCode can't tell creating a file from editing one, so both get the stricter level. */
const fileWrites = (autonomy: Autonomy) => strictest(autonomy.create, autonomy.edit);

/**
 * Autonomy as OpenCode session rules. OpenCode applies the last rule that matches,
 * so the catch-all `ask` comes first: anything not listed (files outside the
 * working directory, subagents, MCP tools, tools this list doesn't know) asks.
 * Only `allow` and `deny` need rules of their own.
 */
export const permissionRules = (autonomy: Autonomy): ReadonlyArray<OpenCodePermissionRule> => {
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
  notes.push("Anything outside the working folder asks first, whatever the autonomy says.");
  return { autonomy: { ...autonomy, create: writes, edit: writes }, notes };
};
