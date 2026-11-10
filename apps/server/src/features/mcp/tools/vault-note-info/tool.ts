import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultIndex } from "../../../indexing/vault-index.js";
import { getNote } from "../../../notes/get-note/use-case.js";
import { VaultCaller } from "../../auth.js";
import { indexUnavailable, iso, Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";

/** Most outgoing links listed. */
const MAX_LINKS = 100;

export const VaultNoteInfo = vaultTool(
  Tool.make("vault_note_info", {
    description:
      "A note's title, tags, frontmatter, headings (to read or cite one section), outgoing links and how many notes link to it. Not its text: read the file for that.",
    parameters: Schema.Struct({ path: VaultPath }),
    success: Schema.Struct({
      path: Schema.String,
      title: Schema.String,
      tags: Schema.Array(Schema.String),
      frontmatter: Schema.Record(Schema.String, Schema.Json),
      modifiedAt: Schema.String,
      headings: Schema.Array(
        Schema.Struct({
          depth: Schema.Number,
          text: Schema.String,
          cite: Schema.String.annotate({ description: "How to cite this section." }),
        }),
      ),
      links: Schema.Array(
        Schema.Struct({
          target: Schema.String,
          path: Schema.NullOr(Schema.String).annotate({ description: "Where it resolves; null when the link is broken." }),
          kind: Schema.Literals(["wikilink", "embed", "markdown"]),
        }),
      ),
      backlinks: Schema.Number.annotate({ description: "How many notes link here; vault_backlinks lists them." }),
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

/** `Folder/Note.md` and `Plan` → `[[Folder/Note#Plan]]`. */
export const citation = (path: string, heading?: string) =>
  `[[${path.replace(/\.md$/i, "")}${heading === undefined ? "" : `#${heading}`}]]`;

export const vaultNoteInfo = Effect.fnUntraced(function* (params: typeof VaultNoteInfo.parametersSchema.Type) {
  const { vaultId } = yield* VaultCaller;
  if (!params.path.toLowerCase().endsWith(".md")) {
    return yield* new ToolFailure({ message: `"${params.path}" isn't a note; vault_note_info takes a markdown file (.md).` });
  }
  const note = yield* getNote({ vaultId, path: params.path });
  const backlinks = yield* (yield* VaultIndex).backlinks(vaultId, note.path);
  const notices: Array<string> = [];
  if (note.links.length > MAX_LINKS) notices.push(`Showing the first ${MAX_LINKS} of ${note.links.length} links.`);
  return {
    path: note.path,
    title: note.title,
    tags: note.tags,
    frontmatter: note.frontmatter,
    modifiedAt: iso(note.modifiedAt),
    headings: note.headings.map((heading) => ({ depth: heading.depth, text: heading.text, cite: citation(note.path, heading.text) })),
    links: note.links.slice(0, MAX_LINKS).map((link) => ({ target: link.target, path: link.path, kind: link.kind })),
    backlinks: backlinks.length,
    notices,
  };
}, Effect.catchTags({
  DbError: () => Effect.fail(indexUnavailable()),
  InvalidVaultPath: (error) => Effect.fail(new ToolFailure({ message: `"${error.path}" isn't a path inside the vault.` })),
  VaultFileNotFound: (error) =>
    Effect.fail(new ToolFailure({ message: `There is no note at "${error.path}". Find it with vault_search or vault_resolve_link.` })),
  VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
  PlatformError: (error) => Effect.fail(new ToolFailure({ message: `The note couldn't be read (${error.reason._tag}).` })),
}));
