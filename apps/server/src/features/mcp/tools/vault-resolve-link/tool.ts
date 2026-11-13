import { basename } from "node:path";
import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { resolveLinks } from "../../../notes/resolve-links/use-case.js";
import { inScope } from "../../../agents/sources.js";
import { VaultCaller } from "../../auth.js";
import { scopeNotices, usableScope } from "../../scope.js";
import { indexUnavailable, Notices, ToolFailure, vaultTool } from "../shared.js";

export const VaultResolveLink = vaultTool(
  Tool.make("vault_resolve_link", {
    description:
      "Finds the file a wikilink points to, by the same rules as the vault (exact path, then relative, then the shortest path whose name matches).",
    parameters: Schema.Struct({
      link: Schema.String.check(Schema.isNonEmpty()).annotate({
        description: "The link as written, with or without brackets: `Note`, `Folder/Note#Heading`, `[[Note|alias]]`.",
      }),
      from: Schema.optionalKey(
        Schema.String.check(Schema.isNonEmpty()).annotate({
          description: "The note the link is in (vault-relative path), for relative links and same-folder matches.",
        }),
      ),
    }),
    success: Schema.Struct({
      target: Schema.String,
      heading: Schema.NullOr(Schema.String),
      path: Schema.NullOr(Schema.String).annotate({ description: "The vault-relative path; null when nothing matches." }),
      title: Schema.NullOr(Schema.String),
      alternatives: Schema.Array(Schema.String).annotate({ description: "Other files the name also matches." }),
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

export const vaultResolveLink = Effect.fnUntraced(function* (params: typeof VaultResolveLink.parametersSchema.Type) {
  const { vaultId } = yield* VaultCaller;
  const scope = yield* usableScope;
  const { links } = yield* resolveLinks({ vaultId, links: [params.from === undefined ? { link: params.link } : { link: params.link, from: params.from }] });
  const found = links[0];
  if (found === undefined) return yield* new ToolFailure({ message: "The link couldn't be resolved." });
  // Files outside the agent's folders are as if they weren't there.
  const reachable = [found.path, ...found.alternatives].filter((path): path is string => path !== null && inScope(scope, path));
  const resolved =
    found.path !== null && inScope(scope, found.path)
      ? { ...found, alternatives: found.alternatives.filter((path) => inScope(scope, path)) }
      : { ...found, path: reachable[0] ?? null, title: reachable[0] === undefined ? null : basename(reachable[0]).replace(/\.md$/i, ""), alternatives: reachable.slice(1) };
  const notices: Array<string> = [...scopeNotices(scope)];
  if (resolved.path === null) notices.push("Nothing in the vault matches this link. Search for the note with vault_search.");
  if (resolved.alternatives.length > 0) {
    notices.push(
      `The name is ambiguous: ${resolved.alternatives.length + 1} files match. Chose ${resolved.path} (${params.from === undefined ? "shortest path" : "same folder as `from`, else shortest path"}); link by full path to pick another.`,
    );
  }
  if (resolved.heading !== null) notices.push("The heading isn't checked here; vault_note_info lists the note's headings.");
  return {
    target: resolved.target,
    heading: resolved.heading,
    path: resolved.path,
    title: resolved.title,
    alternatives: resolved.alternatives,
    notices,
  };
}, Effect.catchTags({
  DbError: () => Effect.fail(indexUnavailable()),
  VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
}));
