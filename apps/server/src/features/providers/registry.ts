import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
import { Context, Data, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import type { ProviderAdapter } from "./port.js";

export class ProviderInstanceNotFound extends Data.TaggedError("ProviderInstanceNotFound")<{
  readonly providerInstanceId: string;
}> {}

export interface ProviderRegistryService {
  /** Configured instances whose adapter is available, oldest first. */
  readonly list: Effect.Effect<ReadonlyArray<ProviderInstance>, DbError>;
  /** The instance used when a thread doesn't name one. */
  readonly defaultInstance: Effect.Effect<ProviderInstance, DbError | ProviderInstanceNotFound>;
  readonly get: (
    providerInstanceId: string,
  ) => Effect.Effect<{ readonly instance: ProviderInstance; readonly adapter: ProviderAdapter }, DbError | ProviderInstanceNotFound>;
}

export class ProviderRegistry extends Context.Service<ProviderRegistry, ProviderRegistryService>()("ProviderRegistry") {}
