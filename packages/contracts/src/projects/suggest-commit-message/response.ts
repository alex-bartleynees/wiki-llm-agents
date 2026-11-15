import { Schema } from "effect";
import { TurnUsage } from "../../threads/model.js";
import { CommitMessageProvider } from "../model.js";

export const SuggestCommitMessageResponse = Schema.Struct({
  /** The suggestion, to edit before committing. */
  message: Schema.String,
  provider: CommitMessageProvider,
  /** Tokens and cost; null when the provider reports none (cost null on subscriptions). */
  usage: Schema.NullOr(TurnUsage),
  /** Some diffs were cut or left out of the prompt to keep it short. */
  truncated: Schema.Boolean,
});
export type SuggestCommitMessageResponse = typeof SuggestCommitMessageResponse.Type;
