import { resolve } from "node:path";
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem } from "effect";
import { commandNamesProtected, reachesProtected } from "../../../shared/secret-paths.js";
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

/**
 * `config.toml` overrides for the thread: Codex's web search can't ask first, so it is
 * on only when the web is allowed. With protected paths, the thread runs under a
 * permission profile like the read-only sandbox (read everything, write nothing) that
 * also denies reading them, so the sandbox itself stops every command reaching them,
 * however it names them. Checked with Codex 0.167.1: the profile wins over
 * `sandbox_mode`, a folder denies what is inside, and a path that doesn't exist is fine.
 */
export const autonomyConfig = (autonomy: Autonomy, protectedPaths: ReadonlyArray<string>): Record<string, unknown> => ({
  web_search: autonomy.web === "allow" ? "live" : "disabled",
  "features.default_mode_request_user_input": true,
  ...(protectedPaths.length === 0
    ? {}
    : {
        default_permissions: PERMISSION_PROFILE,
        [`permissions.${PERMISSION_PROFILE}.filesystem`]: Object.fromEntries([[":root", "read"], ...protectedPaths.map((path) => [path, "none"])]),
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
  /** Paths holding secrets: a change touching one is denied whatever the autonomy. */
  readonly protectedPaths: ReadonlyArray<string>;
}

/**
 * Allow, ask or deny a patch: creating a file follows `create`, changing or
 * deleting one `edit`, and a patch touching several files the strictest of them.
 * Files outside `roots` ask (or stay denied), whatever the autonomy says.
 */
export const decideFileChange = Effect.fnUntraced(function* (input: FileChangeDecision): Effect.fn.Return<AutonomyLevel, never, FileSystem.FileSystem> {
  if (input.changes.length === 0) return "ask" as const;
  if (yield* reachesProtected(input.protectedPaths, input.cwd, changedPaths(input.changes, input.cwd))) return "deny" as const;
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
export const decideCommand = (autonomy: Autonomy, protectedPaths: ReadonlyArray<string>, command: string): AutonomyLevel =>
  commandNamesProtected(protectedPaths, command) ? "deny" : autonomy.commands;

/** Codex asks for more access than the sandbox gives: never to a protected path. */
export const permissionsReachProtected = (protectedPaths: ReadonlyArray<string>, permissions: unknown) =>
  commandNamesProtected(protectedPaths, JSON.stringify(permissions) ?? "");

/** What Codex enforces for `autonomy`, with notes where it differs from the file. */
export const enforcedAutonomy = (autonomy: Autonomy) => {
  const notes = ["Changes to files outside the working folder ask first, whatever the autonomy says."];
  if (autonomy.read !== "allow" || autonomy.commands !== "allow") {
    notes.push("Codex reads files and runs commands in its read-only sandbox without asking, so reading is always allowed; commands that write or use the network follow commands.");
  }
  if (autonomy.web === "ask") notes.push("Codex can't ask before it searches the web, so its web search is off; fetching with a command follows commands.");
  return {
    autonomy: { ...autonomy, read: "allow" as const, web: autonomy.web === "ask" ? ("deny" as const) : autonomy.web },
    notes,
  };
};
