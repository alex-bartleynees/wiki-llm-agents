import { Schema } from "effect";

/** What a provider can do; the UI hides what it lacks. */
export const ProviderCapabilities = Schema.Struct({
  interrupt: Schema.Boolean,
  /** Continue a turn (and its pending requests) after a server restart. */
  resume: Schema.Boolean,
  approvals: Schema.Boolean,
  questions: Schema.Boolean,
});
export type ProviderCapabilities = typeof ProviderCapabilities.Type;

/** A configured provider: a kind (replay, opencode...) with its own settings. */
export const ProviderInstance = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  capabilities: ProviderCapabilities,
});
export type ProviderInstance = typeof ProviderInstance.Type;
