/**
 * Recorded Codex conversations, made by `scripts/record-codex.ts` through the real
 * adapter and `codex app-server`, and played back to the adapter by
 * `fake-app-server.ts`.
 */
import type { Autonomy } from "@wiki-agents/contracts/agents/model";
import type { JsonRpcId, JsonRpcMessage } from "../../../src/features/providers/codex/protocol.js";
import type { FixtureImage } from "../image.js";

export { VAULT_FILES } from "../opencode/fixture.js";

/** Recorded paths start with this instead of the temp folder they were made in. */
export const VAULT = "/__vault__";
/** The recorded Codex thread id, replaced by the fake's. */
export const THREAD = "__thread__";
/** Your home folder in recorded messages. */
export const HOME = "/__home__";

/** One thing that happened during a turn, in order. */
export type FixtureStep =
  /** A notification or request from Codex. */
  | { readonly message: JsonRpcMessage }
  /** The adapter's answer to the request with this id (played back, it must answer the same). */
  | { readonly response: { readonly id: JsonRpcId; readonly result: unknown } }
  /** The recorder pressed Stop (the adapter sent `turn/interrupt`). */
  | { readonly interrupt: true };

export interface FixtureTurn {
  readonly prompt: string;
  /** Images sent with the prompt (`tests/fixtures/image.ts`). */
  readonly images?: ReadonlyArray<FixtureImage>;
  readonly steps: ReadonlyArray<FixtureStep>;
}

export interface Fixture {
  readonly scenario: string;
  readonly codexVersion: string;
  readonly model: string;
  /** The autonomy the session ran with. */
  readonly autonomy: Autonomy;
  readonly turns: ReadonlyArray<FixtureTurn>;
}
