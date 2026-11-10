import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { cases } from "../fixtures/search-eval/cases.js";
import { TestApp } from "./infrastructure/test-app.js";
import { newVaultWith, newThread, post, decode } from "./infrastructure/threads.js";
import { tokenFor, mcpSession } from "./infrastructure/mcp.js";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { HttpClient } from "effect/http";

const root = new URL("../fixtures/search-eval/vault/", import.meta.url).pathname;
const files = Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
  const path = join(entry.parentPath, entry.name);
  return [relative(root, path), readFileSync(path, "utf8")];
}));

layer(TestApp)("FTS evaluation baseline", (it) => {
  it.effect("measures recall, noise and latency against fixed relevance judgements, retaining current and superseded evidence", () => Effect.gen(function* () {
    const vault = yield* newVaultWith(files);
    const thread = yield* newThread(vault.id);
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
    const metrics = [];
    for (const item of cases) {
      const start = performance.now();
      const found = yield* mcp.result<{ results: ReadonlyArray<{ path: string }>; linked: ReadonlyArray<{ path: string }> }>("vault_search", { query: item.query, hops: 1 });
      const elapsedMs = performance.now() - start;
      const paths = [...new Set([...found.results, ...found.linked].map((note) => note.path))];
      const hits = paths.filter((path) => (item.relevant as readonly string[]).includes(path)).length;
      const recall = hits / item.relevant.length;
      expect(paths, item.question).toContain(item.current);
      const currentNote = yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=${encodeURIComponent(item.current)}`).pipe(Effect.flatMap(decode(GetNoteResponse)));
      expect(currentNote.html).toContain(item.fact);
      expect(recall, item.question).toBeGreaterThanOrEqual(0.5);
      const rawPaths = found.results.map((note) => note.path);
      const rawHits = rawPaths.filter((path) => (item.relevant as readonly string[]).includes(path)).length;
      metrics.push({ question: item.question, query: item.query,
        fts: { paths: rawPaths, recall: rawHits / item.relevant.length, irrelevant: rawPaths.length - rawHits },
        expanded: { paths, recall, irrelevant: paths.length - hits }, elapsedMs: Math.round(elapsedMs * 100) / 100 });
    }
    // Timing is diagnostic, never a flaky wall-clock acceptance threshold.
    if (process.env.WIKI_AGENTS_SEARCH_EVAL_REPORT) writeFileSync(process.env.WIKI_AGENTS_SEARCH_EVAL_REPORT, JSON.stringify({ retrieval: "FTS5 plus one link hop", noteCount: Object.keys(files).length, cases: metrics }, null, 2) + "\n");
  }));
  it.effect("replaces stale facts and removes deleted notes from search after explicit indexing", () => Effect.gen(function* () {
    const vault = yield* newVaultWith(files);
    const path = "Decisions/2026-02 Decaf Supplier Change.md";
    writeFileSync(join(vault.rootPath, path), "# Decaf Supplier Change\n\nDecaf now comes from Harbour Beans, Swiss Water process.");
    yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] });
    const search = (q: string) => HttpClient.get(`/api/vaults/${vault.id}/search?q=${encodeURIComponent(q)}`).pipe(Effect.flatMap(decode(SearchNotesResponse)));
    expect((yield* search("Harbour")).results.map((hit) => hit.path)).toEqual([path]);
    expect((yield* search("Collective")).results).toEqual([]);
    yield* post(`/api/vaults/${vault.id}/rebuild-index`, {});
    expect((yield* search("Harbour")).results.map((hit) => hit.path)).toEqual([path]);
    unlinkSync(join(vault.rootPath, path));
    yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] });
    expect((yield* search("Harbour")).results).toEqual([]);
  }));
});
