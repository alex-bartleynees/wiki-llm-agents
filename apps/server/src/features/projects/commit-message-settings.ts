import type { GetCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/get-commit-message-settings/response";
import { Effect } from "effect";
import { commitMessageProvider } from "./commit-message-provider.js";
import { ProjectRepository } from "./repository.js";

/** The saved settings and what a suggestion would use now (null when no provider is available). */
export const settingsView = Effect.gen(function* () {
  const settings = yield* (yield* ProjectRepository).commitMessageSettings;
  const effective = yield* commitMessageProvider.pipe(
    Effect.map(({ provider }) => provider),
    Effect.catchTags({ NoCommitMessageProvider: () => Effect.succeed(null), ProviderInstanceNotFound: () => Effect.succeed(null) }),
  );
  return { settings, effective } satisfies GetCommitMessageSettingsResponse;
});
