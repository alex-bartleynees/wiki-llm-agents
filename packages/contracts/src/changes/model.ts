import { Schema } from "effect";

/**
 * Change review for vaults: what a turn changed in its vault's notes, as recorded
 * from the index while the turn ran, with a diff and an undo.
 */

export const ChangeKind = Schema.Literals(["create", "modify", "delete"]);
export type ChangeKind = typeof ChangeKind.Type;

/**
 * - `agent`: the provider reported writing this file during the turn
 * - `uncertain`: it changed during the turn, but the provider didn't say it wrote it
 *   (you, Syncthing, or one of the agent's shell commands)
 */
export const Attribution = Schema.Literals(["agent", "uncertain"]);
export type Attribution = typeof Attribution.Type;

/** A file a turn changed, as shown on the turn's card. */
export const FileChange = Schema.Struct({
  id: Schema.String,
  /** Vault-relative path. */
  path: Schema.String,
  change: ChangeKind,
  attribution: Attribution,
  /**
   * Unified diff (hunks only, three lines of context), cut to a bounded size;
   * `truncated` says when. The full before and after come from `GET /api/changes/:id`.
   */
  diff: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  truncated: Schema.Boolean,
  /** Signs of a damaging edit (much shorter, title changed, tags dropped); never blocks anything. */
  warnings: Schema.Array(Schema.String),
});
export type FileChange = typeof FileChange.Type;

/** An edit the agent asks to make, on its approval card. */
export const ProposedEdit = Schema.Struct({
  /** The file, as the agent named it (relative to its working folder when inside it). */
  path: Schema.String,
  /** The provider's unified diff of the edit. */
  patch: Schema.String,
  warnings: Schema.Array(Schema.String),
});
export type ProposedEdit = typeof ProposedEdit.Type;
