import { Data, Effect } from "effect";
import type { ProviderAdapter } from "../providers/port.js";

export class UnknownModel extends Data.TaggedError("UnknownModel")<{ readonly model: string }> {}

/** Validate before creating a thread/worktree or changing an existing thread. */
export const validateModel = Effect.fn("validateModel")(function* (adapter: ProviderAdapter, cwd: string, model: string) {
  if (!adapter.capabilities.models) return yield* new UnknownModel({ model });
  const offered = yield* adapter.listModels(cwd);
  if (!offered.models.some(entry => entry.id === model)) return yield* new UnknownModel({ model });
});
