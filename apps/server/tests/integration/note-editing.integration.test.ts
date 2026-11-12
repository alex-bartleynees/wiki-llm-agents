import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import type { FileChange } from "@wiki-agents/contracts/changes/model";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetNoteSourceResponse } from "@wiki-agents/contracts/notes/get-note-source/response";
import { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import { SearchNotesResponse } from "@wiki-agents/contracts/search/search-notes/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, interrupt, isTag, newThread, newVaultWith, sendOk, watch } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const source = (vaultId: string, path: string) =>
  HttpClient.get(`/api/vaults/${vaultId}/note/source?path=${encodeURIComponent(path)}`);
const sourceOk = (vaultId: string, path: string) => source(vaultId, path).pipe(Effect.flatMap(decode(GetNoteSourceResponse)));

const save = (vaultId: string, body: { path: string; content: string; baseHash: string | null }) =>
  HttpClient.execute(HttpClientRequest.put(`/api/vaults/${vaultId}/note/source`).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const saveOk = (vaultId: string, body: { path: string; content: string; baseHash: string | null }) =>
  save(vaultId, body).pipe(Effect.flatMap(decode(SaveNoteResponse)));

const search = (vaultId: string, q: string) =>
  HttpClient.get(`/api/vaults/${vaultId}/search?q=${encodeURIComponent(q)}`).pipe(Effect.flatMap(decode(SearchNotesResponse)));

/** Hidden temporary files left in a folder (a save renames its own away). */
const leftovers = (folder: string) => readdirSync(folder).filter((name) => name.endsWith(".tmp"));

layer(makeTestApp({ providers: provider.registry }))("note editing", (it) => {
  it.effect("reads a note's source with the hash of its bytes", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "---\ntags: [tea]\n---\n# Tea\r\n\r\nGreen.\n" });
      const note = yield* sourceOk(vault.id, "Tea.md");
      expect(note).toMatchObject({
        vaultId: vault.id,
        path: "Tea.md",
        content: "---\ntags: [tea]\n---\n# Tea\r\n\r\nGreen.\n",
        hash: sha256("---\ntags: [tea]\n---\n# Tea\r\n\r\nGreen.\n"),
      });
      expect(note.modifiedAt).toBe(Math.trunc(statSync(join(vault.rootPath, "Tea.md")).mtimeMs));
      expect((yield* source(vault.id, "Coffee.md")).status).toBe(404);
    }),
  );

  it.effect("saves from the version it started from, keeps permissions, and indexes before answering", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n\nGreen.\n", "Other.md": "# Other" });
      const file = join(vault.rootPath, "Tea.md");
      chmodSync(file, 0o640);
      const before = yield* sourceOk(vault.id, "Tea.md");

      const saved = yield* saveOk(vault.id, { path: "Tea.md", content: "# Tea\n\nGreen.\nSencha and [[Other]].\n", baseHash: before.hash });
      expect(saved.hash).toBe(sha256("# Tea\n\nGreen.\nSencha and [[Other]].\n"));
      expect(readFileSync(file, "utf8")).toBe("# Tea\n\nGreen.\nSencha and [[Other]].\n");
      expect(statSync(file).mode & 0o777).toBe(0o640);
      expect(leftovers(vault.rootPath)).toEqual([]);
      expect((yield* search(vault.id, "sencha")).results.map((result) => result.path)).toEqual(["Tea.md"]);
      expect((yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=Tea.md`).pipe(Effect.flatMap(decode(GetNoteResponse)))).links).toEqual([
        { kind: "wikilink", target: "Other", path: "Other.md" },
      ]);

      // Saving what is already there writes nothing.
      const again = yield* saveOk(vault.id, { path: "Tea.md", content: "# Tea\n\nGreen.\nSencha and [[Other]].\n", baseHash: saved.hash });
      expect(again).toEqual(saved);
    }),
  );

  it.effect("refuses a save when the note changed or was deleted on disk, and writes nothing", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n" });
      const file = join(vault.rootPath, "Tea.md");
      const before = yield* sourceOk(vault.id, "Tea.md");
      writeFileSync(file, "# Tea\n\nChanged in Obsidian.\n");

      const refused = yield* save(vault.id, { path: "Tea.md", content: "# Tea\n\nMine.\n", baseHash: before.hash });
      expect(refused.status).toBe(409);
      expect(yield* refused.text).toMatch(/changed on disk/);
      expect(readFileSync(file, "utf8")).toBe("# Tea\n\nChanged in Obsidian.\n");

      // Taking the disk version as the base again lets the save through.
      const current = yield* sourceOk(vault.id, "Tea.md");
      expect(current.content).toBe("# Tea\n\nChanged in Obsidian.\n");
      yield* saveOk(vault.id, { path: "Tea.md", content: "# Tea\n\nMine.\n", baseHash: current.hash });

      rmSync(file);
      expect((yield* save(vault.id, { path: "Tea.md", content: "# Tea\n", baseHash: sha256("# Tea\n\nMine.\n") })).status).toBe(409);
      expect(readdirSync(vault.rootPath)).toEqual([]);
    }),
  );

  it.effect("creates a note (and its folders) only when it doesn't exist yet", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "index.md": "# Home" });
      const created = yield* saveOk(vault.id, { path: "Journal/2026/Nov.md", content: "# November\n", baseHash: null });
      expect(created.path).toBe("Journal/2026/Nov.md");
      expect(readFileSync(join(vault.rootPath, "Journal/2026/Nov.md"), "utf8")).toBe("# November\n");
      expect((yield* save(vault.id, { path: "Journal/2026/Nov.md", content: "# Other\n", baseHash: null })).status).toBe(409);
      expect(readFileSync(join(vault.rootPath, "Journal/2026/Nov.md"), "utf8")).toBe("# November\n");
    }),
  );

  it.effect("refuses paths outside the vault, ignored folders, and files that aren't notes", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "index.md": "# Home", "notes.txt": "plain" });
      for (const path of ["../outside.md", "/etc/passwd.md", ".obsidian/workspace.md", "notes.txt", "a/../../b.md"]) {
        expect((yield* save(vault.id, { path, content: "x", baseHash: null })).status, path).toBe(400);
        expect((yield* source(vault.id, path)).status, path).toBe(400);
      }
      expect((yield* save("missing", { path: "index.md", content: "x", baseHash: null })).status).toBe(404);
      expect((yield* save(vault.id, { path: "index.md", content: 3, baseHash: null } as never)).status).toBe(400);
    }),
  );

  it.effect("doesn't record the user's saves against an agent turn running in the vault", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n", "Coffee.md": "# Coffee\n" });
      provider.scripts.set("wait", ({ turnId }) =>
        Effect.succeed([
          { _tag: "request.opened", turnId, requestId: `${turnId}:q`, prompt: { _tag: "question", question: "Wait?", options: [] } },
        ]),
      );
      const thread = yield* newThread(vault.id, "scripted");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "wait");
      yield* events.until(isTag("request.opened"));

      const tea = yield* sourceOk(vault.id, "Tea.md");
      yield* saveOk(vault.id, { path: "Tea.md", content: "# Tea\n\nMine.\n", baseHash: tea.hash });
      // Someone else's change during the turn is still recorded, as uncertain.
      writeFileSync(join(vault.rootPath, "Coffee.md"), "# Coffee\n\nSyncthing.\n");
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: ["Coffee.md"] });

      yield* interrupt(thread.id);
      const finished = yield* events.until(isTag("turn.finished"));
      const changes = finished.flatMap((event): ReadonlyArray<FileChange> => (event._tag === "turn.changes" ? event.changes : []));
      expect(changes.map((change) => [change.path, change.attribution])).toEqual([["Coffee.md", "uncertain"]]);
    }),
  );
});
