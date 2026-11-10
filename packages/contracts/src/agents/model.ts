import { Schema } from "effect";

/**
 * Named agents are markdown files in the app's config directory
 * (`agents/<id>.md`): the body is the agent's instructions, the frontmatter its
 * settings. Rules (`rules/*.md`) apply to every agent in every vault.
 */

/** What an agent may do without asking: `allow` it, `ask` you first, or `deny` it. */
export const AutonomyLevel = Schema.Literals(["allow", "ask", "deny"]);
export type AutonomyLevel = typeof AutonomyLevel.Type;

/** The actions autonomy is set for. */
export const AUTONOMY_ACTIONS = ["read", "create", "edit", "commands", "web"] as const;
export type AutonomyAction = (typeof AUTONOMY_ACTIONS)[number];

/**
 * Autonomy per action:
 * - `read`: read files and search them
 * - `create`: create files
 * - `edit`: change or delete existing files
 * - `commands`: run shell commands
 * - `web`: fetch pages and search the web
 */
export const Autonomy = Schema.Struct({
  read: AutonomyLevel,
  create: AutonomyLevel,
  edit: AutonomyLevel,
  commands: AutonomyLevel,
  web: AutonomyLevel,
});
export type Autonomy = typeof Autonomy.Type;

/** Without an agent, or for actions an agent's file leaves out: read freely, ask for the rest. */
export const DEFAULT_AUTONOMY: Autonomy = { read: "allow", create: "ask", edit: "ask", commands: "ask", web: "ask" };

/** How a provider enforces an agent's autonomy; it may be stricter than the file asks. */
export const AutonomyEnforcement = Schema.Struct({
  providerInstanceId: Schema.String,
  /** What the provider actually does per action; null when it runs no tools (replay). */
  autonomy: Schema.NullOr(Autonomy),
  /** Where it differs from the file, and why. */
  notes: Schema.Array(Schema.String),
});
export type AutonomyEnforcement = typeof AutonomyEnforcement.Type;

export const AgentSummary = Schema.Struct({
  /** The file name without `.md`, e.g. `researcher`. */
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  /** The provider instance new threads with this agent use; null for the one you pick. */
  provider: Schema.NullOr(Schema.String),
  /** The model new threads with this agent use; null for the provider's default. */
  model: Schema.NullOr(Schema.String),
  /** Knowledge sources, e.g. `vault`, `web`. Informational until the vault MCP server (slice 7). */
  sources: Schema.Array(Schema.String),
  autonomy: Autonomy,
  /** How many background tasks it runs at once (slice 13). */
  concurrency: Schema.Number,
  /** Absolute path of the agent's file. */
  path: Schema.String,
  enforcement: Schema.Array(AutonomyEnforcement),
});
export type AgentSummary = typeof AgentSummary.Type;

/** A rules file applied to every agent. */
export const RulesFile = Schema.Struct({
  /** The file name without `.md`, e.g. `wiki-llm`. */
  id: Schema.String,
  path: Schema.String,
});
export type RulesFile = typeof RulesFile.Type;

/** A file in the config directory that couldn't be used, and why. */
export const ConfigProblem = Schema.Struct({
  path: Schema.String,
  message: Schema.String,
});
export type ConfigProblem = typeof ConfigProblem.Type;
