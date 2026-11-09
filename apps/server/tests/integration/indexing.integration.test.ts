import { mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, layer } from "@effect/vitest";
import { VaultEvent } from "@wiki-agents/contracts/indexing/event";
import { RebuildIndexResponse } from "@wiki-agents/contracts/indexing/rebuild-index/response";
import { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { sql } from "drizzle-orm";
import { Deferred, Duration, Effect, Fiber, PubSub, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeTestApp, TestApp } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";

const FILES = {
  "index.md": "# Home\n\nSee [[Plan]], [[Projects/Plan]] and ![[diagram.png]].",
  "Projects/Plan.md": "---\ntags: [plan]\n---\n# Plan\n\nBack to [[index]].",
  "Other.md": "# Other",
  "assets/diagram.png": "png",
};

/** A fresh vault with `FILES`, registered through the API (which waits for the first scan). */
const newVault = (files: Record<string, string> = FILES) =>
  Effect.gen(function* () {
    const { root } = yield* makeTestVault({ files });
    const response = yield* HttpClient.execute(
      HttpClientRequest.post("/api/vaults").pipe(HttpClientRequest.bodyJsonUnsafe({ rootPath: root })),
    );
    const { vault } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    return { vault, root, write };
  });

const getJson = <A>(path: string, schema: Schema.ConstraintDecoder<A>) =>
  HttpClient.get(path).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  );

const backlinks = (vault: Vault, path: string) =>
  getJson(`/api/vaults/${vault.id}/backlinks?path=${encodeURIComponent(path)}`, GetBacklinksResponse).pipe(
    Effect.map((response) => response.backlinks.map((link) => link.path)),
  );

const treePaths = (vault: Vault) =>
  getJson(`/api/vaults/${vault.id}/tree`, GetTreeResponse).pipe(Effect.map((tree) => tree.entries.map((entry) => entry.path)));

const sync = (vault: Vault, ...paths: Array<string>) =>
  Effect.gen(function* () {
    yield* (yield* Indexer).run({ _tag: "Sync", vault, paths });
  });

/** Everything the index holds for a vault, in a stable order. */
const snapshot = (vaultId: string) =>
  Effect.map(Sqlite, ({ db }) => ({
    files: db.all(sql`SELECT path, kind, size, mtime_ms FROM vault_files WHERE vault_id = ${vaultId} ORDER BY path`),
    notes: db.all(sql`SELECT path, title, frontmatter, tags, content_hash FROM notes WHERE vault_id = ${vaultId} ORDER BY path`),
    links: db.all(
      sql`SELECT src_path, kind, target, target_path FROM links WHERE vault_id = ${vaultId} ORDER BY src_path, kind, target`,
    ),
    search: db.all(sql`SELECT path, title, body, tags FROM notes_fts WHERE vault_id = ${vaultId} ORDER BY path`),
  }));

layer(TestApp)("vault index", (it) => {
  it.effect("indexes files, notes, and resolved links when a vault is registered", () =>
    Effect.gen(function* () {
      const { vault } = yield* newVault();
      expect(yield* treePaths(vault)).toEqual(["assets/diagram.png", "index.md", "Other.md", "Projects/Plan.md"]);
      expect(yield* backlinks(vault, "Projects/Plan.md")).toEqual(["index.md"]);
      expect(yield* backlinks(vault, "assets/diagram.png")).toEqual(["index.md"]);
      expect(yield* backlinks(vault, "index.md")).toEqual(["Projects/Plan.md"]);
      expect((yield* snapshot(vault.id)).search).toContainEqual({
        path: "Projects/Plan.md",
        title: "Plan",
        body: "# Plan\n\nBack to [[index]].",
        tags: "plan",
      });
    }),
  );

  it.effect("re-indexes an edited note, moving its backlinks", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      write("index.md", "Now only [[Other]].");
      yield* sync(vault, "index.md");
      expect(yield* backlinks(vault, "Projects/Plan.md")).toEqual([]);
      expect(yield* backlinks(vault, "Other.md")).toEqual(["index.md"]);
    }),
  );

  it.effect("on a rename, links by name follow the note and links by full path break", () =>
    Effect.gen(function* () {
      const { vault, root } = yield* newVault();
      mkdirSync(join(root, "Archive"));
      renameSync(join(root, "Projects/Plan.md"), join(root, "Archive/Plan.md"));
      yield* sync(vault, "Projects/Plan.md", "Archive/Plan.md");

      expect(yield* treePaths(vault)).toContain("Archive/Plan.md");
      expect(yield* treePaths(vault)).not.toContain("Projects/Plan.md");
      expect(yield* backlinks(vault, "Archive/Plan.md")).toEqual(["index.md"]);
      const { links } = yield* snapshot(vault.id);
      expect(links).toContainEqual({ src_path: "index.md", kind: "wikilink", target: "Plan", target_path: "Archive/Plan.md" });
      expect(links).toContainEqual({ src_path: "index.md", kind: "wikilink", target: "Projects/Plan", target_path: null });
      expect(links).toContainEqual({ src_path: "Archive/Plan.md", kind: "wikilink", target: "index", target_path: "index.md" });
    }),
  );

  it.effect("a deleted folder removes everything indexed under it", () =>
    Effect.gen(function* () {
      const { vault, root } = yield* newVault();
      rmSync(join(root, "Projects"), { recursive: true });
      yield* sync(vault, "Projects");
      expect(yield* treePaths(vault)).toEqual(["assets/diagram.png", "index.md", "Other.md"]);
      const searchable = (yield* snapshot(vault.id)).search.map((row) => (row as { readonly path: string }).path);
      expect(searchable.sort()).toEqual(["Other.md", "index.md"]);
    }),
  );

  it.effect("a new folder is scanned", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      write("New/Deep/Idea.md", "[[Plan]]");
      yield* sync(vault, "New");
      expect(yield* treePaths(vault)).toContain("New/Deep/Idea.md");
      // Sorted by title: "Idea" before "index".
      expect(yield* backlinks(vault, "Projects/Plan.md")).toEqual(["New/Deep/Idea.md", "index.md"]);
    }),
  );

  it.effect("reports changed paths, and not files that were only touched", () =>
    Effect.gen(function* () {
      const { vault, root, write } = yield* newVault();
      const subscription = yield* (yield* Indexer).subscribe;
      utimesSync(join(root, "index.md"), new Date(), new Date(Date.now() + 60_000));
      yield* sync(vault, "index.md");
      write("Other.md", "# Other, edited");
      yield* sync(vault, "Other.md");
      expect(yield* PubSub.take(subscription)).toEqual({ type: "vault.changed", vaultId: vault.id, paths: ["Other.md"] });
    }),
  );

  it.effect("applies commands in the order they were queued", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      const indexer = yield* Indexer;
      write("first.md", "one");
      yield* indexer.enqueue({ _tag: "Sync", vault, paths: ["first.md"] });
      write("second.md", "two");
      yield* indexer.run({ _tag: "Sync", vault, paths: ["second.md"] });
      // run() returns only after everything queued before it has been applied.
      expect(yield* treePaths(vault)).toEqual(expect.arrayContaining(["first.md", "second.md"]));
    }),
  );

  it.effect("ignores paths outside the vault and ignored names", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      write(".obsidian/workspace.md", "hidden");
      write("Other.sync-conflict-20260803-092856-ZMVBMAF.md", "conflict");
      const before = yield* snapshot(vault.id);
      yield* sync(vault, "../outside/secret.md", ".obsidian/workspace.md", "Other.sync-conflict-20260803-092856-ZMVBMAF.md");
      expect(yield* snapshot(vault.id)).toEqual(before);
    }),
  );

  it.effect("drops the blob of a note's old content once nothing uses it", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      // Blobs are shared by identical content, so start from content only this test has.
      write("Other.md", `# Other ${vault.id}`);
      yield* sync(vault, "Other.md");
      const { db } = yield* Sqlite;
      const hashOf = () =>
        (db.get(sql`SELECT content_hash AS hash FROM notes WHERE vault_id = ${vault.id} AND path = 'Other.md'`) as { hash: string }).hash;
      const blobExists = (hash: string) => db.get(sql`SELECT 1 AS found FROM blobs WHERE hash = ${hash}`) !== undefined;
      const oldHash = hashOf();
      write("Other.md", "# Other, rewritten");
      yield* sync(vault, "Other.md");
      expect(blobExists(oldHash)).toBe(false);
      expect(blobExists(hashOf())).toBe(true);
    }),
  );

  it.effect("a rebuild gives the same index as incremental updates", () =>
    Effect.gen(function* () {
      const { vault, root, write } = yield* newVault();
      write("index.md", "# Home\n\n[[Plan]] [[Missing]] [md](Other.md)");
      write("Projects/Second.md", "[[index]] ![[diagram.png]]");
      mkdirSync(join(root, "Archive"));
      renameSync(join(root, "Projects/Plan.md"), join(root, "Archive/Plan.md"));
      rmSync(join(root, "Other.md"));
      yield* sync(vault, "index.md", "Projects/Second.md", "Projects/Plan.md", "Archive", "Other.md");
      const incremental = yield* snapshot(vault.id);

      const response = yield* HttpClient.execute(HttpClientRequest.post(`/api/vaults/${vault.id}/rebuild-index`));
      expect(yield* HttpClientResponse.schemaBodyJson(RebuildIndexResponse)(response)).toEqual({ files: 4, notes: 3 });
      expect(yield* snapshot(vault.id)).toEqual(incremental);
    }),
  );

  it.effect("streams change events after `ready`", () =>
    Effect.gen(function* () {
      const { vault, write } = yield* newVault();
      const ready = yield* Deferred.make<void>();
      const response = yield* HttpClient.get(`/events/vaults/${vault.id}`);
      expect(response.headers["content-type"]).toBe("text/event-stream");
      const events = yield* response.stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.startsWith("data: ")),
        Stream.map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(VaultEvent))(line.slice(6))),
        Stream.tap((event) => (event.type === "ready" ? Deferred.succeed(ready, undefined) : Effect.void)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      write("Fresh.md", "new");
      yield* sync(vault, "Fresh.md");
      expect(yield* Fiber.join(events)).toEqual([
        { type: "ready" },
        { type: "vault.changed", vaultId: vault.id, paths: ["Fresh.md"] },
      ]);
    }),
  );

  it.effect("rejects unknown vaults", () =>
    Effect.gen(function* () {
      expect((yield* HttpClient.get("/api/vaults/nope/backlinks?path=a.md")).status).toBe(404);
      expect((yield* HttpClient.execute(HttpClientRequest.post("/api/vaults/nope/rebuild-index"))).status).toBe(404);
      expect((yield* HttpClient.get("/events/vaults/nope")).status).toBe(404);
    }),
  );
});

describe("watching vault folders", () => {
  // Real clock: the watcher debounces with Effect.sleep. No polling: the test awaits the event.
  layer(makeTestApp({ watch: true }), { excludeTestServices: true })("with the real watcher", (it) => {
    it.effect("re-indexes a file written on disk and publishes the change", () =>
      Effect.gen(function* () {
        const { vault, write } = yield* newVault();
        const subscription = yield* (yield* Indexer).subscribe;
        write("Projects/Watched.md", "[[index]]");
        const event = yield* PubSub.take(subscription).pipe(Effect.timeout(Duration.seconds(10)));
        expect(event).toEqual({ type: "vault.changed", vaultId: vault.id, paths: ["Projects/Watched.md"] });
        expect(yield* backlinks(vault, "index.md")).toEqual(["Projects/Plan.md", "Projects/Watched.md"]);
      }),
    );
  });
});
