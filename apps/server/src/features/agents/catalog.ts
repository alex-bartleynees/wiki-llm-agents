import type { ConfigProblem } from "@wiki-agents/contracts/agents/model";
import { Context, Data, type Effect, type PubSub, type Scope } from "effect";
import type { AgentDefinition, RulesDefinition } from "./definition.js";

/** Everything loaded from the config directory at one moment. */
export interface AgentConfig {
  readonly configDir: string;
  /** By id, so they apply in a stable order. */
  readonly rules: ReadonlyArray<RulesDefinition>;
  /** By name. */
  readonly agents: ReadonlyArray<AgentDefinition>;
  /** Files that couldn't be used. */
  readonly problems: ReadonlyArray<ConfigProblem>;
}

/** No such agent, or its file has problems (`problem` says what). */
export class AgentNotFound extends Data.TaggedError("AgentNotFound")<{
  readonly agentId: string;
  readonly problem: string | null;
}> {
  get reason() {
    return this.problem === null ? `There is no agent "${this.agentId}".` : `The agent "${this.agentId}" can't be used: ${this.problem}`;
  }
}

/**
 * The rules and named agents in the app's config directory, reloaded when the
 * files change. Features read agents through this port only.
 */
export interface AgentCatalogService {
  readonly current: Effect.Effect<AgentConfig>;
  readonly get: (agentId: string) => Effect.Effect<AgentDefinition, AgentNotFound>;
  /** Reads the directory again now. */
  readonly reload: Effect.Effect<AgentConfig>;
  /** Each config loaded after subscribing (from a file change or `reload`). */
  readonly subscribe: Effect.Effect<PubSub.Subscription<AgentConfig>, never, Scope.Scope>;
}

export class AgentCatalog extends Context.Service<AgentCatalog, AgentCatalogService>()("AgentCatalog") {}
