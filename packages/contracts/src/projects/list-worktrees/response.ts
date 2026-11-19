import { Schema } from "effect";
import { Worktree } from "../model.js";

export const ListedWorktree = Schema.Struct({
  ...Worktree.fields,
  /** False once removed, or when its folder was deleted outside the app. */
  exists: Schema.Boolean,
  /** Files that differ from the worktree's `HEAD`, ignored files left out; null when it doesn't exist. */
  changedFiles: Schema.NullOr(Schema.Number),
  /** Other threads working in it too (threads continued with the same folder), oldest first. */
  sharedWith: Schema.Array(Schema.String),
});
export type ListedWorktree = typeof ListedWorktree.Type;

export const ListWorktreesResponse = Schema.Struct({
  /** Whether new threads can have a worktree: the main directory is in git, committed, and outside the shared vault. */
  available: Schema.Boolean,
  /** Why not, when `available` is false. */
  unavailableReason: Schema.NullOr(Schema.String),
  /** The project's thread worktrees, oldest first, removed ones included. */
  worktrees: Schema.Array(ListedWorktree),
});
export type ListWorktreesResponse = typeof ListWorktreesResponse.Type;
