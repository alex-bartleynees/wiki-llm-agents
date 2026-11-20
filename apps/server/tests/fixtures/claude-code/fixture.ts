/**
 * Recorded Claude Code conversations, made by `scripts/record-claude-code.ts` through
 * the real adapter and SDK, and played back to the adapter by `fake-sdk.ts`.
 */
import type { Autonomy, AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import type { FixtureImage } from "../image.js";

export { VAULT_FILES } from "../opencode/fixture.js";

/** Recorded paths start with this instead of the temp folder they were made in. */
export const VAULT = "/__vault__";
/** Recorded session ids, replaced by the id the adapter chose. */
export const SESSION = "__session__";
/** Your home folder in recorded messages. */
export const HOME = "/__home__";

/** One thing that happened during a turn, in order. */
export type FixtureStep =
  /** A message from Claude Code (an `SDKMessage`, cut down to what the adapter reads). */
  | { readonly message: unknown }
  /** Claude Code ran the adapter's `PreToolUse` hook, which decided this (`defer`: left it to Claude Code). */
  /** `agentId`: a subagent's tool call (its task id). */
  | {
      readonly hook: { readonly toolName: string; readonly toolInput: unknown; readonly toolUseId: string; readonly agentId?: string };
      readonly decision: AutonomyLevel | "defer";
    }
  /** Claude Code asked the adapter's `canUseTool`, which answered this (after the recorder answered the request). `agentId`: a subagent asked. */
  | {
      readonly permission: { readonly toolName: string; readonly toolInput: unknown; readonly toolUseId: string; readonly blockedPath?: string; readonly agentId?: string };
      readonly behavior: "allow" | "deny";
    }
  /** The recorder pressed Stop. */
  | { readonly interrupt: true };

/**
 * One message sent and everything up to the next: with background subagents, that
 * includes their work, their reports, and the turns Claude Code started for them.
 */
export interface FixtureTurn {
  readonly prompt: string;
  /** Images sent with the prompt (`tests/fixtures/image.ts`). */
  readonly images?: ReadonlyArray<FixtureImage>;
  readonly steps: ReadonlyArray<FixtureStep>;
}

export interface Fixture {
  readonly scenario: string;
  readonly claudeCodeVersion: string;
  readonly model: string;
  /** The autonomy the session ran with. */
  readonly autonomy: Autonomy;
  readonly turns: ReadonlyArray<FixtureTurn>;
}
