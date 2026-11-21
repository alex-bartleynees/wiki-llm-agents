import { Schema } from "effect";

/** What a provider can do; the UI hides what it lacks. */
export const ProviderCapabilities = Schema.Struct({
  interrupt: Schema.Boolean,
  /** Continue a turn (and its pending requests) after a server restart. */
  resume: Schema.Boolean,
  approvals: Schema.Boolean,
  questions: Schema.Boolean,
  /** Offers a choice of models (`GET /api/threads/:id/models`). */
  models: Schema.Boolean,
  /**
   * Takes images from a message as images (the model sees them). Without it, images
   * are sent like any other file: listed by path for the agent to read.
   */
  images: Schema.Boolean,
  /**
   * Compacts a thread's conversation on request (Compact conversation), with the
   * provider's own compaction. Absent means it can't.
   */
  compact: Schema.optionalKey(Schema.Boolean),
});
export type ProviderCapabilities = typeof ProviderCapabilities.Type;

/** A configured provider: a kind (replay, opencode...) with its own settings. */
export const ProviderInstance = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  toolFreeCompletion: Schema.optionalKey(Schema.Literal(true)),
  name: Schema.String,
  capabilities: ProviderCapabilities,
});
export type ProviderInstance = typeof ProviderInstance.Type;

/**
 * The provider can run turns. `version` is the installed agent's, when it has one;
 * `account` is who it is signed in as (e.g. `you@example.com (pro)`), when it says.
 */
export const ProviderReady = Schema.TaggedStruct("ready", {
  version: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
});

/** It can't, and why: not installed, an unsupported version, or it failed to start. */
export const ProviderUnavailable = Schema.TaggedStruct("unavailable", {
  reason: Schema.String,
});

export const ProviderStatus = Schema.Union([ProviderReady, ProviderUnavailable]);
export type ProviderStatus = typeof ProviderStatus.Type;

export const ProviderReadiness = Schema.Union([Schema.TaggedStruct("ready", {}), ProviderUnavailable]);
export type ProviderReadiness = typeof ProviderReadiness.Type;

/** A model a provider offers. */
export const ProviderModel = Schema.Struct({
  /** The provider's name for it, e.g. `opencode/big-pickle`. */
  id: Schema.String,
  name: Schema.String,
  /** Costs nothing per token (free tiers, local models). */
  free: Schema.Boolean,
  /**
   * Takes images as input, as its provider reports (Codex `inputModalities`, OpenCode
   * `capabilities.input`; every Claude model does). The composer offers to send
   * images as files to a model without it.
   */
  images: Schema.Boolean,
});
export type ProviderModel = typeof ProviderModel.Type;
