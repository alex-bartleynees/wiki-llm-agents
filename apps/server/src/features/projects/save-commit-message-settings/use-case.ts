import type { SaveCommitMessageSettingsRequest } from "@wiki-agents/contracts/projects/save-commit-message-settings/request";
import { Effect } from "effect";
import { ProviderRegistry } from "../../providers/registry.js";
import { settingsView } from "../commit-message-settings.js";
import { ProjectRepository } from "../repository.js";

/** Saves the choice (a provider must exist; a blank model means its default; no provider, no model) and gives what it resolves to. */
export const saveCommitMessageSettings = Effect.fn("saveCommitMessageSettings")(function* (request: SaveCommitMessageSettingsRequest) {
  if (request.providerInstanceId !== null) yield* (yield* ProviderRegistry).get(request.providerInstanceId);
  // A model belongs to a chosen provider; the default picks its own.
  const model = request.providerInstanceId === null ? null : request.model?.trim() || null;
  yield* (yield* ProjectRepository).saveCommitMessageSettings({ providerInstanceId: request.providerInstanceId, model });
  return yield* settingsView;
});
