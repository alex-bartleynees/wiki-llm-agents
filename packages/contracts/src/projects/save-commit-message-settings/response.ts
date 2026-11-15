import { GetCommitMessageSettingsResponse } from "../get-commit-message-settings/response.js";

/** The settings as saved, and what a suggestion would use now. */
export const SaveCommitMessageSettingsResponse = GetCommitMessageSettingsResponse;
export type SaveCommitMessageSettingsResponse = typeof SaveCommitMessageSettingsResponse.Type;
