/**
 * Recorded OpenCode 2 conversations, made by `scripts/record-opencode.ts` and
 * played back through the real adapter by the fake API in `fake-api.ts`.
 */
import type { FixtureImage } from "../image.js";

/** Recorded paths start with this instead of the temp folder they were made in. */
export const VAULT = "/__vault__";

/** The vault every scenario runs against. */
export const VAULT_FILES: Readonly<Record<string, string>> = {
  "index.md": "# Home\n\nNotes about drinks. See [[Coffee]] and [[Tea]].\n",
  "Notes/Coffee.md": "# Coffee\n\nI like flat whites. See [[Tea]].\n",
  "Notes/Tea.md": "# Tea\n\nGreen tea in the afternoon.\n",
};

/** One thing that happened during a turn, in order. */
export type FixtureStep =
  /** An event of the session, as sent on OpenCode's wire (encoded `OpenCodeEvent`). */
  | { readonly event: unknown }
  /** The recorder answered a request: `once`/`reject`, or a question's text. */
  | { readonly call: "reply"; readonly requestId: string; readonly reply: string }
  /** The recorder pressed Stop; what withdrawing the message and interrupting returned. */
  | { readonly call: "interrupt"; readonly withdrawn: boolean; readonly interrupted: boolean };

export interface FixtureTurn {
  readonly prompt: string;
  /** Images sent with the prompt (`tests/fixtures/image.ts`). */
  readonly images?: ReadonlyArray<FixtureImage>;
  readonly steps: ReadonlyArray<FixtureStep>;
}

export interface Fixture {
  readonly scenario: string;
  readonly opencodeVersion: string;
  readonly model: string | null;
  readonly sessionId: string;
  readonly turns: ReadonlyArray<FixtureTurn>;
}
