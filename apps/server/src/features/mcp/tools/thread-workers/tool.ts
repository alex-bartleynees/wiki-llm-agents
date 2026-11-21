import { ProviderReadiness } from "@wiki-agents/contracts/providers/model";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { discoverWorkers } from "../../../threads/manager-threads.js";
import { VaultCaller } from "../../auth.js";
import { ToolFailure, vaultTool } from "../shared.js";

export const ThreadWorkers = vaultTool(Tool.make("thread_workers", {
  failure: ToolFailure,
  dependencies: [VaultCaller],
  description: "List eligible agents with their applicable model defaults and default launch provider instances, and show readiness or a reason for every provider instance.",
  success: Schema.Struct({
    workers: Schema.Array(Schema.Struct({
      agentId: Schema.String,
      name: Schema.String,
      description: Schema.String,
      providerInstanceId: Schema.String,
      providerConfigured: Schema.Boolean,
      status: ProviderReadiness,
      model: Schema.NullOr(Schema.String),
    })),
    providers: Schema.Array(Schema.Struct({ providerInstanceId: Schema.String, name: Schema.String, supportsModels: Schema.Boolean, status: ProviderReadiness })),
  }),
}));

export const threadWorkers = <E, R>(manager: Effect.Effect<ThreadSummary, E, R>) =>
  Effect.flatMap(manager, discoverWorkers);
