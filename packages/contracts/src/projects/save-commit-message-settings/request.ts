import { Schema } from "effect";
import { CommitMessageSettings } from "../model.js";

/** PUT /api/commit-messages/settings with this body; the provider must exist. */
export const SaveCommitMessageSettingsRequest = CommitMessageSettings;
export type SaveCommitMessageSettingsRequest = typeof SaveCommitMessageSettingsRequest.Type;
