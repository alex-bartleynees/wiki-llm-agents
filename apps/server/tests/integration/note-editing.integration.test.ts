import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import type { FileChange } from "@wiki-agents/contracts/changes/model";
import { DeleteNoteResponse } from "@wiki-agents/contracts/notes/delete-note/response";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetNoteSourceResponse } from "@wiki-agents/contracts/notes/get-note-source/response";
import { SaveNoteResponse } from "@wiki-agents/contracts/notes/save-note/response";
import { UploadImageResponse } from "@wiki-agents/contracts/notes/upload-image/response";
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

const remove = (vaultId: string, path: string, hash: string) =>
  HttpClient.del(`/api/vaults/${vaultId}/note?path=${encodeURIComponent(path)}&hash=${hash}`);
const removeOk = (vaultId: string, path: string, hash: string) => remove(vaultId, path, hash).pipe(Effect.flatMap(decode(DeleteNoteResponse)));

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
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n", "Coffee.md": "# Coffee\n", "Milk.md": "# Milk\n" });
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
      yield* removeOk(vault.id, "Milk.md", sha256("# Milk\n"));
      // Someone else's change during the turn is still recorded, as uncertain.
      writeFileSync(join(vault.rootPath, "Coffee.md"), "# Coffee\n\nSyncthing.\n");
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: ["Coffee.md"] });

      yield* interrupt(thread.id);
      const finished = yield* events.until(isTag("turn.finished"));
      const changes = finished.flatMap((event): ReadonlyArray<FileChange> => (event._tag === "turn.changes" ? event.changes : []));
      expect(changes.map((change) => [change.path, change.attribution])).toEqual([["Coffee.md", "uncertain"]]);
    }),
  );

  it.effect("moves a note to .trash/ only if unchanged, never replacing what is there, and unindexes it", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Drinks/Tea.md": "# Tea\n", "Coffee.md": "See [[Tea]].\n", "Other/Tea.md": "# Other tea\n" });
      const tea = sha256("# Tea\n");

      // Changed since it was seen: refused, nothing moves.
      const stale = yield* remove(vault.id, "Drinks/Tea.md", sha256("# Old tea\n"));
      expect([stale.status, yield* stale.text]).toEqual([409, "The note has changed since you opened it; look at it again before deleting."]);
      expect(readFileSync(join(vault.rootPath, "Drinks/Tea.md"), "utf8")).toBe("# Tea\n");

      expect(yield* removeOk(vault.id, "Drinks/Tea.md", tea)).toEqual({ path: "Drinks/Tea.md", trashPath: ".trash/Tea.md" });
      expect(readdirSync(join(vault.rootPath, "Drinks"))).toEqual([]);
      expect(readFileSync(join(vault.rootPath, ".trash/Tea.md"), "utf8")).toBe("# Tea\n");
      expect((yield* search(vault.id, "tea")).results.map((result) => result.path)).not.toContain("Drinks/Tea.md");
      // Coffee's [[Tea]] now finds the other Tea.
      const coffee = yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=Coffee.md`).pipe(Effect.flatMap(decode(GetNoteResponse)));
      expect(coffee.links).toEqual([{ kind: "wikilink", target: "Tea", path: "Other/Tea.md" }]);

      // A second note of the same name goes beside the first in the trash.
      expect((yield* removeOk(vault.id, "Other/Tea.md", sha256("# Other tea\n"))).trashPath).toBe(".trash/Tea 1.md");
      expect(readFileSync(join(vault.rootPath, ".trash/Tea.md"), "utf8")).toBe("# Tea\n");

      expect((yield* remove(vault.id, "Drinks/Tea.md", tea)).status).toBe(404);
      expect((yield* remove(vault.id, "../Tea.md", tea)).status).toBe(400);
      expect((yield* remove(vault.id, ".trash/Tea.md", tea)).status).toBe(400);
      expect((yield* remove("nope", "Coffee.md", tea)).status).toBe(404);
      expect((yield* HttpClient.del(`/api/vaults/${vault.id}/note?path=Coffee.md`)).status).toBe(400);
    }),
  );
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const upload = (vaultId: string, name: string, bytes: Uint8Array = PNG) =>
  HttpClient.execute(
    HttpClientRequest.post(`/api/vaults/${vaultId}/assets?name=${encodeURIComponent(name)}`).pipe(
      HttpClientRequest.bodyUint8Array(bytes, "image/png"),
    ),
  );
const uploadOk = (vaultId: string, name: string, bytes?: Uint8Array) =>
  upload(vaultId, name, bytes).pipe(
    Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(201))),
    Effect.flatMap(decode(UploadImageResponse)),
  );

layer(makeTestApp())("image upload", (it) => {
  it.effect("adds an image to assets/, never replacing one, indexed before answering", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n" });
      const first = yield* uploadOk(vault.id, "Pasted image 20261113101500.png");
      expect(first.path).toBe("assets/Pasted image 20261113101500.png");
      expect(new Uint8Array(readFileSync(join(vault.rootPath, first.path)))).toEqual(PNG);

      // The same name again gets the next free one; the first file is untouched.
      const other = new Uint8Array([...PNG, 9]);
      expect((yield* uploadOk(vault.id, "Pasted image 20261113101500.png", other)).path).toBe("assets/Pasted image 20261113101500 1.png");
      expect((yield* uploadOk(vault.id, "Pasted image 20261113101500.PNG")).path).toBe("assets/Pasted image 20261113101500 2.png");
      expect(new Uint8Array(readFileSync(join(vault.rootPath, first.path)))).toEqual(PNG);
      expect(readdirSync(join(vault.rootPath, "assets")).filter((name) => name.startsWith("."))).toEqual([]);

      // Characters that break a wikilink become dashes; folders in the name are dropped.
      expect((yield* uploadOk(vault.id, "../a#b|c[1].jpg")).path).toBe("assets/a-b-c-1-.jpg");

      // A note embedding it renders the image straight away.
      yield* saveOk(vault.id, { path: "Tea.md", content: "# Tea\n\n![[Pasted image 20261113101500.png]]\n", baseHash: sha256("# Tea\n") });
      const note = yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=Tea.md`).pipe(Effect.flatMap(decode(GetNoteResponse)));
      expect(note.links).toEqual([{ kind: "embed", target: "Pasted image 20261113101500.png", path: first.path }]);
      expect(note.html).toContain("<img");
    }),
  );

  it.effect("refuses what isn't an image, empty bodies, and an assets folder outside the vault", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n" });
      for (const [name, bytes, message] of [
        ["notes.md", PNG, "Only images can be added: png, jpg, jpeg, gif, webp, avif, bmp"],
        ["drawing.svg", PNG, "Only images can be added: png, jpg, jpeg, gif, webp, avif, bmp"],
        [".png", PNG, "Only images can be added: png, jpg, jpeg, gif, webp, avif, bmp"],
        ["empty.png", new Uint8Array(), "The image is empty"],
      ] as const) {
        const response = yield* upload(vault.id, name, bytes);
        expect(response.status).toBe(400);
        expect(yield* response.text).toBe(message);
      }
      expect((yield* HttpClient.post(`/api/vaults/${vault.id}/assets`)).status).toBe(400);
      expect((yield* upload("nope", "a.png")).status).toBe(404);
      const huge = yield* upload(vault.id, "huge.png", new Uint8Array(20 * 1024 * 1024 + 1));
      expect([huge.status, yield* huge.text]).toEqual([413, "Images are limited to 20 MB"]);
      expect(readdirSync(vault.rootPath)).toEqual(["Tea.md"]);

      const outside = join(vault.rootPath, "..", `${vault.id}-outside`);
      mkdirSync(outside);
      symlinkSync(outside, join(vault.rootPath, "assets"));
      expect((yield* upload(vault.id, "a.png")).status).toBe(400);
      expect(readdirSync(outside)).toEqual([]);
      rmSync(outside, { recursive: true });
    }),
  );
});
