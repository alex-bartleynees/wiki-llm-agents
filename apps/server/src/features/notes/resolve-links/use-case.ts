import { fileKind, viewHref } from "@wiki-agents/contracts/notes/model";
import type { LinkToResolve } from "@wiki-agents/contracts/notes/resolve-links/request";
import type { ResolvedLink, ResolveLinksResponse } from "@wiki-agents/contracts/notes/resolve-links/response";
import { Effect } from "effect";
import { slug } from "github-slugger";
import { makeLinkIndex, parseWikilink, resolveLinkTarget, suffixMatches } from "../../../shared/markdown/link-resolution.js";
import { VaultIndex } from "../../indexing/vault-index.js";
import { findVault } from "../../vaults/find-vault.js";

export interface ResolveLinksInput {
  readonly vaultId: string;
  readonly links: ReadonlyArray<LinkToResolve>;
}

/** `[[Note#Heading|alias]]` or `Note#Heading|alias` → the inside of the brackets. */
const inner = (link: string) => link.trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "");

/**
 * Resolves wikilinks against the vault index, as the renderer does: the same rules,
 * the same heading anchors. Used for citations in agents' answers and by
 * `vault_resolve_link`.
 */
export const resolveLinks = Effect.fn("resolveLinks")(function* (input: ResolveLinksInput) {
  const vault = yield* findVault(input.vaultId);
  const files = yield* (yield* VaultIndex).titledFiles(vault.id);
  const index = makeLinkIndex(files.map((file) => file.path));
  const titles = new Map(files.map((file) => [file.path, file.title]));

  const resolve = ({ link, from }: LinkToResolve): ResolvedLink => {
    const parsed = parseWikilink(inner(link));
    const heading = parsed.heading ?? null;
    const path = resolveLinkTarget(index, parsed.target, from ?? "") ?? null;
    const kind = path === null ? null : fileKind(path);
    const view = path === null ? undefined : viewHref(vault.id, path);
    const href = view === undefined ? null : kind === "note" && heading !== null ? `${view}#${slug(heading)}` : view;
    const matches = suffixMatches(index, parsed.target);
    return {
      link,
      target: parsed.target,
      heading,
      alias: parsed.alias ?? null,
      path,
      kind,
      title: path === null ? null : (titles.get(path) ?? null),
      href,
      alternatives: matches.length > 1 ? matches.filter((match) => match !== path) : [],
    };
  };

  const response: ResolveLinksResponse = { links: input.links.map(resolve) };
  return response;
});
