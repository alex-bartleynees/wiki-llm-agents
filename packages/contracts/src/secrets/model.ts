import { Schema } from "effect";

/**
 * Secrets MCP servers use by name (`${secret:github}`): tokens the app keeps
 * encrypted on this machine, or files declared in the service's configuration (sops-nix,
 * agenix). Values go in and never come out: the API gives names and dates only.
 */

/**
 * Where a secret's value is:
 * - `stored`: encrypted in the app's data directory, entered in Settings
 * - `declared`: a file named in `WIKI_AGENTS_SECRET_FILES`, read when it is used; changed outside the app
 */
export const SecretSource = Schema.Literals(["stored", "declared"]);
export type SecretSource = typeof SecretSource.Type;

/** A project's browser sign-in whose credential names the secret. */
export const SecretSignInUse = Schema.Struct({
  projectId: Schema.String,
  /** The project's name. */
  project: Schema.String,
  /** The sign-in's name. */
  signIn: Schema.String,
});
export type SecretSignInUse = typeof SecretSignInUse.Type;

/** What uses a secret, for people: `github`, `sign-in "My app" in Shop`. */
export const describeSecretUses = (servers: ReadonlyArray<string>, signIns: ReadonlyArray<SecretSignInUse>): ReadonlyArray<string> => [
  ...servers,
  ...signIns.map((use) => `sign-in "${use.signIn}" in ${use.project}`),
];

export const SecretSummary = Schema.Struct({
  /** Lowercase letters, digits and hyphens, as in `${secret:<name>}`. */
  name: Schema.String,
  source: SecretSource,
  /** When it was last set (ms since the epoch); null for a declared file. */
  createdAt: Schema.NullOr(Schema.Number),
  /** When the token stops working, if you said; null otherwise. */
  expiresAt: Schema.NullOr(Schema.Number),
  /** Whether it can be read right now. */
  available: Schema.Boolean,
  /** Why not, when it can't. */
  problem: Schema.NullOr(Schema.String),
  /** Ids of the MCP servers that refer to it. */
  usedBy: Schema.Array(Schema.String),
  /** Projects' browser sign-ins that refer to it. */
  usedBySignIns: Schema.Array(SecretSignInUse),
});
export type SecretSummary = typeof SecretSummary.Type;

/**
 * What protects the stored secrets' key:
 * - `systemd-creds`: encrypted by systemd with a key tied to this machine
 * - `file`: a key file readable only by you, outside the data directory
 */
export const KeySource = Schema.Literals(["systemd-creds", "file"]);
export type KeySource = typeof KeySource.Type;

/** The encrypted store on this machine. */
export const SecretStoreStatus = Schema.Struct({
  /**
   * - `empty`: nothing stored yet
   * - `ready`: stored secrets can be read
   * - `unreadable`: the file is there but its key isn't (or is another machine's); delete the stored secrets and enter them again
   */
  state: Schema.Literals(["empty", "ready", "unreadable"]),
  /** Null until something is stored. */
  keySource: Schema.NullOr(KeySource),
  problem: Schema.NullOr(Schema.String),
});
export type SecretStoreStatus = typeof SecretStoreStatus.Type;

/** The longest value kept: tokens and keys, not files. */
export const MAX_SECRET_BYTES = 16 * 1024;
