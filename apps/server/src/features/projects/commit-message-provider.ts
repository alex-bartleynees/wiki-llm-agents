import type { CommitMessageProvider } from "@wiki-agents/contracts/projects/model";
import { Data, Effect } from "effect";
import type { ProviderAdapter } from "../providers/port.js";
import { ProviderRegistry } from "../providers/registry.js";
import { ProjectRepository } from "./repository.js";

/** The default when nothing is chosen: cheap, and good at short summaries. */
export const DEFAULT_KIND = "claude-code";
export const DEFAULT_MODEL = "haiku";

/** No provider is configured, so there is nothing to ask. */
export class NoCommitMessageProvider extends Data.TaggedError("NoCommitMessageProvider")<{}> {}

/**
 * The provider and model **Suggest message** uses: the saved choice; else Claude Code
 * on Haiku when it is ready (installed, supported, signed in); else the first
 * provider with its default model.
 */
export const commitMessageProvider = Effect.gen(function* () {
  const settings = yield* (yield* ProjectRepository).commitMessageSettings;
  const registry = yield* ProviderRegistry;
  const chosen = (instanceId: string, model: string | null) =>
    Effect.map(registry.get(instanceId), ({ instance, adapter }) => ({
      adapter: adapter as ProviderAdapter,
      provider: { providerInstanceId: instance.id, providerName: instance.name, model } satisfies CommitMessageProvider,
    }));
  if (settings.providerInstanceId !== null) return yield* chosen(settings.providerInstanceId, settings.model);
  const instances = yield* registry.list;
  const claude = instances.find((instance) => instance.kind === DEFAULT_KIND);
  if (claude !== undefined) {
    const found = yield* chosen(claude.id, DEFAULT_MODEL);
    if ((yield* found.adapter.status)._tag === "ready") return found;
  }
  const first = instances[0];
  if (first === undefined) return yield* new NoCommitMessageProvider();
  return yield* chosen(first.id, null);
});
