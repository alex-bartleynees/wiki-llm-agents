import { Schema } from "effect";

/** GET /api/commit-messages/settings */
export const GetCommitMessageSettingsRequest = Schema.Struct({});
export type GetCommitMessageSettingsRequest = typeof GetCommitMessageSettingsRequest.Type;
