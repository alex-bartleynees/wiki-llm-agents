import { resolve } from "node:path";
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem } from "effect";
import { commandNamesProtected, isUnprotected, namePatterns, type Protection, reachesProtected } from "../../../shared/secret-paths.js";
import { pathsWithinRoots } from "../../../shared/vault/path-scope.js";
import type { AskForApproval, FileUpdateChange, SandboxMode } from "./protocol.js";

/**
 * How the agent's autonomy reaches Codex. Every thread runs in Codex's read-only
 * sandbox with the `on-request` approval policy: commands run inside the sandbox
 * (reading, never writing or reaching the network) without asking, and Codex asks
 * the app before it changes a file or runs a command outside the sandbox. The app
 * answers each request from the autonomy (allow, deny) or asks you. (`untrusted`
 * would ask for every command in Codex 0.166, even `cat`.)
 */
export const APPROVAL_POLICY: AskForApproval = "on-request";
export const SANDBOX: SandboxMode = "read-only";

/** The permission profile a thread with protected paths runs under. */
export const PERMISSION_PROFILE = "wiki_agents";

/** A literal for a Codex glob: its special characters each in a class of their own. */
const globLiteral = (text: string) => text.replace(/[[\]{}*?\\]/g, "[$&]");

/**
 * Codex globs for files matching `pattern` but none of `exceptions`. Codex globs only
 * deny (a `read` glob can't reopen a file), so an exception is cut out of the pattern:
 * for `.env.*` without `.env.example`, `.env.`, `.env.[!e]*`, `.env.e`, `.env.e[!x]*`…
 * `.env.example?*` (checked with Codex 0.167.1). That works for a pattern ending in its
 * only `*` (`.env.*`) and exceptions that are plain names; otherwise the exceptions
 * stay denied in Codex's sandbox, the stricter way round.
 */
export const codexNameGlobs = (pattern: string, exceptions: ReadonlyArray<string>): ReadonlyArray<string> => {
  const star = pattern.indexOf("*");
  const prefix = pattern.slice(0, Math.max(star, 0));
  const cuttable = star >= 0 && star === pattern.length - 1 && !prefix.includes("?");
  const cut = cuttable ? exceptions.filter((name) => !/[*?]/.test(name) && name.startsWith(prefix)).map((name) => name.slice(prefix.length)) : [];
  if (cut.length === 0) return [pattern.split(/([*?])/).map((part, index) => (index % 2 === 1 ? part : globLiteral(part))).join("")];
  // Every name starting with `prefix` but no cut-out suffix, walking the suffixes' characters as a tree.
  const globs: Array<string> = [];
  const walk = (start: string) => {
    if (!cut.includes(start)) globs.push(globLiteral(prefix + start));
    const next = [...new Set(cut.filter((suffix) => suffix.length > start.length && suffix.startsWith(start)).map((suffix) => suffix[start.length]!))].sort();
    if (next.length === 0) {
      globs.push(`${globLiteral(prefix + start)}?*`);
      return;
    }
    globs.push(`${globLiteral(prefix + start)}[!${next.map((char) => (char === "]" || char === "!" || char === "\\" ? `\\${char}` : char)).join("")}]*`);
    for (const char of next) walk(start + char);
  };
  walk("");
  return globs;
};

/**
 * The deny entries for `protection` in a permission profile's `filesystem` table: each
 * protected path, and each name pattern as a glob in every folder of `roots` (the
 * working folder, a project's directories). Codex lists a glob's matches when each
 * command starts, so a `.env` made later is denied from the next command on.
 */
export const protectedEntries = (protection: Protection, roots: ReadonlyArray<string>): ReadonlyArray<readonly [string, string]> => {
  const { match, except } = namePatterns(protection.names);
  const globs = match.flatMap((pattern) => codexNameGlobs(pattern, except));
  return [
    ...protection.paths.map((path) => [path, "none"] as const),
    ...[...new Set(roots)].flatMap((root) => globs.map((glob) => [`${globLiteral(root)}/**/${glob}`, "none"] as const)),
  ];
};

/**
 * `protection` without the paths that don't exist. Codex can't deny a missing path in
 * a command you let out of the read-only sandbox: bwrap mounts an empty file over the
 * first missing folder, that mount fails ("Can't bind mount tmpfile on …: No such file
 * or directory"), and so does every such command (Codex 0.169.0). A missing file can't
 * be read; the adapter checks again when each turn starts, so one made later (the key,
 * when you save the first secret) is denied from the next turn on. `exists` is
 * synchronous so a turn's start takes no extra tick: a Stop sent straight after Send
 * must find the turn.
 */
export const existingProtection = (protection: Protection, exists: (path: string) => boolean): Protection => ({
  ...protection,
  paths: protection.paths.filter(exists),
});

/**
 * `config.toml` overrides for the thread: Codex's web search can't ask first, so it is
 * on only when the web is allowed. With anything protected, the thread runs under a
 * permission profile like the read-only sandbox (read everything, write nothing) that
 * also denies reading it, so the sandbox itself stops every command reaching it,
 * however it names it. Checked with Codex 0.167.1: the profile wins over
 * `sandbox_mode`, a folder denies what is inside, and absolute globs
 * (`<root>/**\/.env`) deny every match below the root. Give it only paths that exist
 * (`existingProtection`).
 *
 * A command you let out of the sandbox still runs under the profile (its denials can't
 * be lifted), with the profile's network: none by default, not even a local socket such
 * as the Nix daemon's (`allow_unix_sockets` alone didn't open it; checked with Codex
 * 0.169.0). So with commands allowed the profile has the network, as an approved
 * command had outside the sandbox; asking or denied, it stays off, or commands in the
 * sandbox would reach it without asking.
 */
export const autonomyConfig = (autonomy: Autonomy, protection: Protection, roots: ReadonlyArray<string>): Record<string, unknown> => ({
  web_search: autonomy.web === "allow" ? "live" : "disabled",
  "features.default_mode_request_user_input": true,
  ...(isUnprotected(protection)
    ? {}
    : {
        default_permissions: PERMISSION_PROFILE,
        [`permissions.${PERMISSION_PROFILE}.filesystem`]: Object.fromEntries([[":root", "read"], ...protectedEntries(protection, roots)]),
        ...(autonomy.commands === "allow" ? { [`permissions.${PERMISSION_PROFILE}.network`]: { enabled: true } } : {}),
      }),
});

const STRICTNESS: Readonly<Record<AutonomyLevel, number>> = { allow: 0, ask: 1, deny: 2 };
export const strictest = (a: AutonomyLevel, b: AutonomyLevel) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/** Every file a change touches, as absolute paths (a move touches both). */
export const changedPaths = (changes: ReadonlyArray<FileUpdateChange>, cwd: string): ReadonlyArray<string> =>
  changes.flatMap((change) => [
    resolve(cwd, change.path),
    ...(change.kind.type === "update" && change.kind.move_path !== null ? [resolve(cwd, change.kind.move_path)] : []),
  ]);

/** Whether a change creates its file: an `add` of a file that doesn't exist yet. Anything else edits (or deletes) one. */
export const creates = Effect.fnUntraced(function* (change: FileUpdateChange, cwd: string) {
  if (change.kind.type !== "add") return false;
  const fs = yield* FileSystem.FileSystem;
  return !(yield* fs.exists(resolve(cwd, change.path)).pipe(Effect.orElseSucceed(() => true)));
});

export interface FileChangeDecision {
  readonly autonomy: Autonomy;
  /** Canonical folders the agent may reach without asking (the working folder; a project's directories and vault). */
  readonly roots: ReadonlyArray<string>;
  readonly cwd: string;
  readonly changes: ReadonlyArray<FileUpdateChange>;
  /** What is protected: a change touching it is denied whatever the autonomy. */
  readonly protection: Protection;
}

/**
 * Allow, ask or deny a patch: creating a file follows `create`, changing or
 * deleting one `edit`, and a patch touching several files the strictest of them.
 * Files outside `roots` ask (or stay denied), whatever the autonomy says.
 */
export const decideFileChange = Effect.fnUntraced(function* (input: FileChangeDecision): Effect.fn.Return<AutonomyLevel, never, FileSystem.FileSystem> {
  if (input.changes.length === 0) return "ask" as const;
  if (yield* reachesProtected(input.protection, input.cwd, changedPaths(input.changes, input.cwd))) return "deny" as const;
  let level: AutonomyLevel = "allow";
  for (const change of input.changes) level = strictest(level, (yield* creates(change, input.cwd)) ? input.autonomy.create : input.autonomy.edit);
  if (level === "deny") return level;
  const inside = yield* pathsWithinRoots(input.roots, input.cwd, changedPaths(input.changes, input.cwd));
  return inside ? level : strictest(level, "ask");
});

/**
 * A command Codex asks to run outside its read-only sandbox (to write, or reach the
 * network), where the profile's denials don't apply: one naming a protected path is
 * denied (a best effort; see `commandNamesProtected`).
 */
export const decideCommand = (autonomy: Autonomy, protection: Protection, command: string): AutonomyLevel =>
  commandNamesProtected(protection, command) ? "deny" : autonomy.commands;

/** Codex asks for more access than the sandbox gives: never to a protected path. */
export const permissionsReachProtected = (protection: Protection, permissions: unknown) =>
  commandNamesProtected(protection, JSON.stringify(permissions) ?? "");

/** What Codex enforces for `autonomy`, with notes where it differs from the file. */
export const enforcedAutonomy = (autonomy: Autonomy) => {
  const notes = ["Changes to files outside the working folder ask first, whatever the autonomy says."];
  if (autonomy.read !== "allow" || autonomy.commands !== "allow") {
    notes.push("Codex reads files and runs commands in its read-only sandbox without asking, so reading is always allowed; commands that write or use the network follow commands.");
  }
  if (autonomy.commands !== "allow") {
    notes.push("While files are protected, commands you approve still can't use the network or local sockets (such as Nix's daemon, so no nix develop); allow commands for that.");
  }
  if (autonomy.web === "ask") notes.push("Codex can't ask before it searches the web, so its web search is off; fetching with a command follows commands.");
  // Checked with Codex 0.169.0: `spawn_agent` never asks, and turning off the
  // `multi_agent` and `multi_agent_v2` features doesn't take it away.
  if (autonomy.subagents !== "allow") notes.push("Codex starts its subagents without asking and can't be stopped from starting them, so subagents are always allowed; what they do follows the rest of the autonomy.");
  return {
    autonomy: { ...autonomy, read: "allow" as const, web: autonomy.web === "ask" ? ("deny" as const) : autonomy.web, subagents: "allow" as const },
    notes,
  };
};
