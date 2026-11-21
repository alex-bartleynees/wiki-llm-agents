import { ProviderModel, ProviderReadiness } from "@wiki-agents/contracts/providers/model";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { discoverWorkerModels } from "../../../threads/manager-threads.js";
import { VaultCaller } from "../../auth.js";
import { ToolFailure, vaultTool } from "../shared.js";

const Text = Schema.Trim.check(Schema.isNonEmpty());

export const ThreadWorkerModels = vaultTool(Tool.make("thread_worker_models", {
  failure: ToolFailure,
  dependencies: [VaultCaller],
  description: "List valid models in your workspace for an eligible agent and provider instance. Omit overrides to inspect your own agent and provider.",
  parameters: Schema.Struct({ agentId: Schema.optionalKey(Text), providerInstanceId: Schema.optionalKey(Text) }),
  success: Schema.Struct({
    agentId: Schema.String,
    providerInstanceId: Schema.String,
    status: ProviderReadiness,
    agentDefault: Schema.NullOr(Schema.String),
    defaultModel: Schema.NullOr(Schema.String),
    models: Schema.Array(ProviderModel),
  }),
}));

type Params = typeof ThreadWorkerModels.parametersSchema.Type;

export const threadWorkerModels = <E, R>(manager: Effect.Effect<ThreadSummary, E, R>, params: Params) =>
  Effect.flatMap(manager, (thread) => discoverWorkerModels(thread, params));
