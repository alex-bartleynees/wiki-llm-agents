import { Schema } from "effect";
import { CommitMessageProvider, CommitMessageSettings } from "../model.js";

export const GetCommitMessageSettingsResponse = Schema.Struct({
  settings: CommitMessageSettings,
  /** What a suggestion would use now; null when no provider is available. */
  effective: Schema.NullOr(CommitMessageProvider),
});
export type GetCommitMessageSettingsResponse = typeof GetCommitMessageSettingsResponse.Type;
