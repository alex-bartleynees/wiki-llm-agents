import { Schema } from "effect";

/** Most links one request resolves. */
export const RESOLVE_LINKS_MAX = 100;

/** A link as written inside `[[...]]`: `Note`, `Folder/Note#Heading`, `Note#Heading|alias`. */
export const LinkToResolve = Schema.Struct({
  link: Schema.String.check(Schema.isNonEmpty()),
  /** The note it appears in, for relative and same-folder resolution; the vault root when absent. */
  from: Schema.optionalKey(Schema.String),
});
export type LinkToResolve = typeof LinkToResolve.Type;

/**
 * POST /api/vaults/:vaultId/resolve-links with this body. Resolves wikilinks the way
 * notes do, e.g. the `[[note#heading]]` citations in an agent's answer.
 */
export const ResolveLinksRequest = Schema.Struct({
  links: Schema.Array(LinkToResolve).check(Schema.isMaxLength(RESOLVE_LINKS_MAX)),
});
export type ResolveLinksRequest = typeof ResolveLinksRequest.Type;
