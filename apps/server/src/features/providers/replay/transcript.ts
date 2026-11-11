import type { TurnUsage } from "@wiki-agents/contracts/threads/model";

/**
 * A recorded agent turn, in the app's normalised terms, played back by the replay
 * provider so UI work costs no tokens. Steps play in order; an approval or question
 * waits for your answer, then plays the branch for it.
 */
export type Step =
  /** A reply, streamed a few words at a time. */
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool";
      readonly name: string;
      readonly input: string;
      readonly output: string;
      readonly status?: "succeeded" | "failed";
    }
  /** Appends `append` to the file at `path` (relative to the working folder), creating it if needed: a real write. */
  | { readonly type: "write"; readonly path: string; readonly append: string }
  | {
      readonly type: "approval";
      /** Unique within the transcript; part of the request id. */
      readonly id: string;
      readonly title: string;
      readonly detail: string;
      /**
       * An edit to propose: the card shows its diff against the file as it is now
       * (instead of `detail`), and approving makes it before the `approve` steps.
       */
      readonly write?: { readonly path: string; readonly append: string };
      readonly approve: ReadonlyArray<Step>;
      readonly deny: ReadonlyArray<Step>;
    }
  | {
      readonly type: "question";
      readonly id: string;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      /** `{answer}` in text steps is replaced by your answer. */
      readonly then: ReadonlyArray<Step>;
    }
  /** The provider fails the turn. */
  | { readonly type: "fail"; readonly reason: string }
  /** Nothing happens for a while (milliseconds, before the speed factor). */
  | { readonly type: "pause"; readonly ms: number };

export interface Transcript {
  readonly name: string;
  /** Chosen when the message contains one of these words (case-insensitive). */
  readonly keywords: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<Step>;
  readonly usage: TurnUsage;
}
