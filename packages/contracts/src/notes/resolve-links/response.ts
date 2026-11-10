import { Schema } from "effect";
import { FileKind } from "../model.js";

export const ResolvedLink = Schema.Struct({
  /** The link as sent. */
  link: Schema.String,
  /** The target without heading or alias. */
  target: Schema.String,
  heading: Schema.NullOr(Schema.String),
  alias: Schema.NullOr(Schema.String),
  /** The vault-relative path it resolves to; null when nothing matches. */
  path: Schema.NullOr(Schema.String),
  kind: Schema.NullOr(FileKind),
  /** The note's title (the file name for other files); null when unresolved. */
  title: Schema.NullOr(Schema.String),
  /** Where the app shows it, at the heading for notes; null when unresolved or raw-only. */
  href: Schema.NullOr(Schema.String),
  /** Other files the target also matches, when the choice was ambiguous. */
  alternatives: Schema.Array(Schema.String),
});
export type ResolvedLink = typeof ResolvedLink.Type;

/** One result per link, in the order sent. */
export const ResolveLinksResponse = Schema.Struct({
  links: Schema.Array(ResolvedLink),
});
export type ResolveLinksResponse = typeof ResolveLinksResponse.Type;
