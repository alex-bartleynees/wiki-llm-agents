import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { VaultIndex } from "../../../indexing/vault-index.js";
import { rankNeighbours } from "../../../search/link-hops.js";
import { relatedGraph, rankRelated } from "../../../search/related.js";
import { searchNotes } from "../../../search/search-notes/use-case.js";
import { VaultCaller } from "../../auth.js";
import { IntBetween, indexUnavailable, Notices, ToolFailure, vaultTool } from "../shared.js";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
export const MAX_HOPS = 2;

/** Search is keyword-only until semantic search (rag-ai) arrives. */
export const KEYWORD_ONLY =
  "Keyword search only (SQLite FTS5): notes that say the same thing in other words are missed. Try synonyms or related terms if a search finds too little.";

const Hit = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  snippet: Schema.String.annotate({ description: "A passage around the best match; read the note for more." }),
});

const Linked = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  hop: Schema.Number.annotate({ description: "How many links away from the search results." }),
  via: Schema.Array(Schema.String).annotate({ description: "The notes of the previous hop it links to or is linked from." }),
});

export const VaultSearch = vaultTool(
  Tool.make("vault_search", {
    description:
      "Full-text search over the vault's notes: titles count most, then tags, then the body. Returns paths, titles, tags and a snippet, best match first. With `hops`, also returns notes linked to or from the results.",
    parameters: Schema.Struct({
      query: Schema.String.check(Schema.isNonEmpty()).annotate({
        description: 'Words to find; each matches by prefix (`plan` finds "planning"). Put "exact phrases" in double quotes. No other syntax.',
      }),
      tags: Schema.optionalKey(
        Schema.Array(Schema.String.check(Schema.isNonEmpty())).annotate({
          description: "Only notes with all of these frontmatter tags; `project` also matches `project/app`.",
        }),
      ),
      limit: Schema.optionalKey(IntBetween(1, MAX_LIMIT, `Most results to return (default ${DEFAULT_LIMIT}).`)),
      hops: Schema.optionalKey(
        IntBetween(0, MAX_HOPS, "Also follow links from the results this many times (default 0), returning the linked notes in `linked`."),
      ),
    }),
    success: Schema.Struct({ results: Schema.Array(Hit), linked: Schema.Array(Linked), notices: Notices }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
);

type Params = typeof VaultSearch.parametersSchema.Type;

export const vaultSearch = Effect.fnUntraced(function* (params: Params) {
  const { vaultId } = yield* VaultCaller;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const hops = params.hops ?? 0;
  const tags = params.tags ?? [];
  const notices: Array<string> = [];

  const found = yield* searchNotes({
    vaultId,
    q: params.query,
    tags: tags.join(","),
    limit,
  });
  if (found.results.length === 0 && tags.length > 0 && params.query.trim() !== "") {
    notices.push(`Nothing matched with the tag filter (${tags.join(", ")}); try without it.`);
  }
  if (found.truncated) {
    notices.push(
      limit < MAX_LIMIT
        ? `Showing the best ${limit} matches; there are more. Raise \`limit\` (up to ${MAX_LIMIT}) or narrow the query.`
        : `Showing the best ${limit} matches, the most one search returns; there are more. Narrow the query.`,
    );
  }

  const index = yield* VaultIndex;
  const linked: Array<typeof Linked.Type> = [];
  const seen = new Set(found.results.map((result) => result.path));
  let frontier = found.results.map((result) => result.path);
  const graph = hops > 0 ? yield* relatedGraph(vaultId) : null;
  for (let hop = 1; hop <= hops && frontier.length > 0; hop++) {
    const ranked = rankNeighbours(frontier, graph?.edges ?? [], seen);
    const related = frontier.map((path) => rankRelated(path, graph?.notes ?? [], graph?.edges ?? []));
    const scores = new Map<string, number>();
    for (const notes of related) for (const note of notes) scores.set(note.path, (scores.get(note.path) ?? 0) + note.score);
    const kept = [...ranked].sort((a, b) => (scores.get(b.path) ?? 0) - (scores.get(a.path) ?? 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, limit);
    if (ranked.length > kept.length) {
      notices.push(`Hop ${hop}: showing ${kept.length} of ${ranked.length} linked notes, those linked with the best results.`);
    }
    const summaries = new Map((yield* index.notes(vaultId, kept.map((note) => note.path))).map((note) => [note.path, note]));
    for (const note of kept) {
      seen.add(note.path);
      const summary = summaries.get(note.path);
      linked.push({ path: note.path, title: summary?.title ?? note.path, tags: summary?.tags ?? [], hop, via: note.via });
    }
    frontier = kept.map((note) => note.path);
  }

  notices.push(KEYWORD_ONLY);
  return {
    results: found.results.map((result) => ({
      path: result.path,
      title: result.title,
      tags: result.tags,
      snippet: result.snippet.map((part) => part.text).join(""),
    })),
    linked,
    notices,
  };
}, Effect.catchTags({
  DbError: () => Effect.fail(indexUnavailable()),
  VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
}));
