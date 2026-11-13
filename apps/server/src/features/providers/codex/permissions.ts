import { resolve } from "node:path";
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem } from "effect";
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

/** `config.toml` overrides for the thread: Codex's web search can't ask first, so it is on only when the web is allowed. */
export const autonomyConfig = (autonomy: Autonomy): Record<string, unknown> => ({
  web_search: autonomy.web === "allow" ? "live" : "disabled",
  "features.default_mode_request_user_input": true,
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
}

/**
 * Allow, ask or deny a patch: creating a file follows `create`, changing or
 * deleting one `edit`, and a patch touching several files the strictest of them.
 * Files outside `roots` ask (or stay denied), whatever the autonomy says.
 */
export const decideFileChange = Effect.fnUntraced(function* (input: FileChangeDecision): Effect.fn.Return<AutonomyLevel, never, FileSystem.FileSystem> {
  if (input.changes.length === 0) return "ask" as const;
  let level: AutonomyLevel = "allow";
  for (const change of input.changes) level = strictest(level, (yield* creates(change, input.cwd)) ? input.autonomy.create : input.autonomy.edit);
  if (level === "deny") return level;
  const inside = yield* pathsWithinRoots(input.roots, input.cwd, changedPaths(input.changes, input.cwd));
  return inside ? level : strictest(level, "ask");
});

/** A command Codex asks to run outside its read-only sandbox (to write, or reach the network). */
export const decideCommand = (autonomy: Autonomy): AutonomyLevel => autonomy.commands;

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
