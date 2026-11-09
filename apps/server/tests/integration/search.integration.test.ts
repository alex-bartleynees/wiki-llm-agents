import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { ListTagsResponse } from "@wiki-agents/contracts/search/list-tags/response";
import { QuickSwitchResponse } from "@wiki-agents/contracts/search/quick-switch/response";
import { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { Context, Effect, Layer, type Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { TestApp } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";

const FILES = {
  "Effect Server.md": "---\ntags: [effect, project/app]\n---\n# Effect Server\n\nThe HTTP server runs on Node.",
  "Notes/Running.md": "# Running\n\nShe was running a marathon in the café.\n\nLater: an effect system for TypeScript.",
  "Notes/Plain.md": "# Plain\n\nNothing interesting, but the word server appears once.",
  "Projects/App Plan.md": "---\ntitle: Implementation Plan\ntags: [Project]\n---\nSlices and milestones.",
  "Projects/Sub.md": "---\ntags: [project/app/sub]\n---\nDeep tag.",
  "Reports/Spending.html": "<p>Spending server</p>",
  "data/listings.json": "{}",
  "assets/server.png": "png",
};

class Fixture extends Context.Service<Fixture, { readonly vault: Vault; readonly root: string }>()("Fixture") {}

const FixtureLive = Layer.effect(
  Fixture,
  Effect.gen(function* () {
    const { root } = yield* makeTestVault({ files: FILES });
    const response = yield* HttpClient.execute(
      HttpClientRequest.post("/api/vaults").pipe(HttpClientRequest.bodyJsonUnsafe({ rootPath: root })),
    );
    const { vault } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
    return { vault, root };
  }),
);

const getJson = <A>(path: string, schema: Schema.ConstraintDecoder<A>) =>
  HttpClient.get(path).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

const search = (params: Record<string, string>) =>
  Effect.gen(function* () {
    const { vault } = yield* Fixture;
    return yield* getJson(`/api/vaults/${vault.id}/search?${new URLSearchParams(params)}`, SearchNotesResponse);
  });

const searchPaths = (params: Record<string, string>) => Effect.map(search(params), (response) => response.results.map((result) => result.path));

const switchTo = (q: string) =>
  Effect.gen(function* () {
    const { vault } = yield* Fixture;
    return yield* getJson(`/api/vaults/${vault.id}/quick-switch?q=${encodeURIComponent(q)}`, QuickSwitchResponse);
  });

const status = (path: string) => HttpClient.get(path).pipe(Effect.map((response) => response.status));

layer(FixtureLive.pipe(Layer.provideMerge(TestApp)))("search", (it) => {
  it.effect("finds notes by words in the body, title, or tags, ranking title matches first", () =>
    Effect.gen(function* () {
      expect(yield* searchPaths({ q: "server" })).toEqual(["Effect Server.md", "Notes/Plain.md"]);
      expect(yield* searchPaths({ q: "effect" })).toEqual(["Effect Server.md", "Notes/Running.md"]);
      expect(yield* searchPaths({ q: "implementation" })).toEqual(["Projects/App Plan.md"]);
    }),
  );

  it.effect("matches words by prefix as you type, with stemming and without accents", () =>
    Effect.gen(function* () {
      expect(yield* searchPaths({ q: "marat" })).toEqual(["Notes/Running.md"]);
      // "runs" and "running" both stem to "run"; Running has it in the title.
      expect(yield* searchPaths({ q: "runs" })).toEqual(["Notes/Running.md", "Effect Server.md"]);
      expect(yield* searchPaths({ q: "cafe" })).toEqual(["Notes/Running.md"]);
    }),
  );

  it.effect("needs every word, matches quoted phrases exactly, and treats query syntax as text", () =>
    Effect.gen(function* () {
      expect(yield* searchPaths({ q: "server node" })).toEqual(["Effect Server.md"]);
      expect(yield* searchPaths({ q: '"server runs"' })).toEqual(["Effect Server.md"]);
      expect(yield* searchPaths({ q: '"runs server"' })).toEqual([]);
      expect(yield* searchPaths({ q: 'server OR "unclosed' })).toEqual([]);
      expect(yield* searchPaths({ q: "NEAR( * - :" })).toEqual([]);
      expect(yield* searchPaths({ q: "  " })).toEqual([]);
    }),
  );

  it.effect("returns snippets as text parts with the matches marked", () =>
    Effect.gen(function* () {
      const { results } = yield* search({ q: "marathon" });
      expect(results).toEqual([
        {
          path: "Notes/Running.md",
          title: "Running",
          tags: [],
          snippet: [
            { text: "# Running She was running a ", match: false },
            { text: "marathon", match: true },
            { text: " in the café. Later: an effect system for TypeScript.", match: false },
          ],
        },
      ]);
    }),
  );

  it.effect("filters by tag, including child tags and ignoring case, with or without text", () =>
    Effect.gen(function* () {
      expect(yield* searchPaths({ tags: "project" })).toEqual(["Effect Server.md", "Projects/App Plan.md", "Projects/Sub.md"]);
      expect(yield* searchPaths({ tags: "#Project/App" })).toEqual(["Effect Server.md", "Projects/Sub.md"]);
      expect(yield* searchPaths({ tags: "project/ap" })).toEqual([]);
      expect(yield* searchPaths({ tags: "effect,project" })).toEqual(["Effect Server.md"]);
      expect(yield* searchPaths({ q: "server", tags: "project" })).toEqual(["Effect Server.md"]);
      const { results } = yield* search({ tags: "project/app/sub" });
      expect(results[0]?.snippet).toEqual([{ text: "Deep tag.", match: false }]);
    }),
  );

  it.effect("limits results and says when there were more", () =>
    Effect.gen(function* () {
      const limited = yield* search({ q: "server", limit: "1" });
      expect(limited.results.map((result) => result.path)).toEqual(["Effect Server.md"]);
      expect(limited.truncated).toBe(true);
      expect((yield* search({ q: "server", limit: "2" })).truncated).toBe(false);
      const { vault } = yield* Fixture;
      expect(yield* status(`/api/vaults/${vault.id}/search?q=x&limit=0`)).toBe(400);
      expect(yield* status(`/api/vaults/${vault.id}/search?q=x&limit=lots`)).toBe(400);
      expect(yield* status(`/api/vaults/missing/search?q=x`)).toBe(404);
    }),
  );

  it.effect("finds a changed note by its new words once the indexer has run", () =>
    Effect.gen(function* () {
      const { vault, root } = yield* Fixture;
      const path = "Notes/Fresh.md";
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "# Fresh\n\nzanzibar");
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] });
      expect(yield* searchPaths({ q: "zanzibar" })).toEqual([path]);
      rmSync(join(root, path));
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] });
      expect(yield* searchPaths({ q: "zanzibar" })).toEqual([]);
    }),
  );

  it.effect("lists tags with counts, most used first", () =>
    Effect.gen(function* () {
      const { vault } = yield* Fixture;
      const { tags } = yield* getJson(`/api/vaults/${vault.id}/tags`, ListTagsResponse);
      expect(tags).toEqual([
        { tag: "effect", count: 1 },
        { tag: "Project", count: 1 },
        { tag: "project/app", count: 1 },
        { tag: "project/app/sub", count: 1 },
      ]);
    }),
  );
});

layer(FixtureLive.pipe(Layer.provideMerge(TestApp)))("quick switch", (it) => {
  it.effect("fuzzy-matches titles and paths of notes, pages, and JSON files, best first", () =>
    Effect.gen(function* () {
      const { results } = yield* switchTo("eff serv");
      expect(results[0]).toEqual({
        path: "Effect Server.md",
        kind: "note",
        title: "Effect Server",
        match: { field: "title", positions: [0, 1, 2, 7, 8, 9, 10] },
      });
      expect((yield* switchTo("spend")).results.map((result) => [result.path, result.kind])).toEqual([["Reports/Spending.html", "page"]]);
      expect((yield* switchTo("listings")).results.map((result) => result.path)).toEqual(["data/listings.json"]);
    }),
  );

  it.effect("uses frontmatter titles, and matches the path when the title doesn't", () =>
    Effect.gen(function* () {
      const byTitle = yield* switchTo("impl plan");
      expect(byTitle.results[0]).toMatchObject({ path: "Projects/App Plan.md", title: "Implementation Plan", match: { field: "title" } });
      const byPath = yield* switchTo("projapp");
      expect(byPath.results[0]).toMatchObject({ path: "Projects/App Plan.md", match: { field: "path" } });
    }),
  );

  it.effect("leaves out raw files, and returns nothing for an empty query", () =>
    Effect.gen(function* () {
      expect((yield* switchTo("server.png")).results).toEqual([]);
      expect((yield* switchTo("   ")).results).toEqual([]);
    }),
  );
});
