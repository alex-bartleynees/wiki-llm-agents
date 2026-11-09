import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { ListPinsResponse } from "@wiki-agents/contracts/pins/list-pins/response";
import { PinNoteResponse } from "@wiki-agents/contracts/pins/pin-note/response";
import { UnpinNoteResponse } from "@wiki-agents/contracts/pins/unpin-note/response";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { Effect, type Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { TestApp } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";

const FILES = {
  "index.md": "---\ntitle: Home\n---\n# Welcome\n\n## Getting started\n\n### Install\n\n## Getting started",
  "Projects/Plan.md": "# Plan",
  "Reports/Spending.html": "<p>report</p>",
  ".obsidian/app.json": "{}",
};

const newVault = Effect.gen(function* () {
  const { root } = yield* makeTestVault({ files: FILES });
  const response = yield* HttpClient.execute(
    HttpClientRequest.post("/api/vaults").pipe(HttpClientRequest.bodyJsonUnsafe({ rootPath: root })),
  );
  const { vault } = yield* HttpClientResponse.schemaBodyJson(RegisterVaultResponse)(response);
  return { vault, root };
});

const decode = <A>(schema: Schema.ConstraintDecoder<A>) => (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

const pinsPath = (vault: Vault) => `/api/vaults/${vault.id}/pins`;

const pin = (vault: Vault, path: string) =>
  HttpClient.execute(HttpClientRequest.post(pinsPath(vault)).pipe(HttpClientRequest.bodyJsonUnsafe({ path })));

const unpin = (vault: Vault, path: string) => HttpClient.del(`${pinsPath(vault)}?path=${encodeURIComponent(path)}`);

const listPins = (vault: Vault) => HttpClient.get(pinsPath(vault)).pipe(Effect.flatMap(decode(ListPinsResponse)));

layer(TestApp)("pins", (it) => {
  it.effect("pins files in order with their titles, idempotently, and unpins them", () =>
    Effect.gen(function* () {
      const { vault } = yield* newVault;
      expect((yield* listPins(vault)).pins).toEqual([]);
      yield* pin(vault, "Projects/Plan.md").pipe(Effect.flatMap(decode(PinNoteResponse)));
      yield* pin(vault, "index.md").pipe(Effect.flatMap(decode(PinNoteResponse)));
      const again = yield* pin(vault, "Projects/Plan.md").pipe(Effect.flatMap(decode(PinNoteResponse)));
      expect(again.pins).toEqual([
        { path: "Projects/Plan.md", kind: "note", title: "Plan" },
        { path: "index.md", kind: "note", title: "Home" },
      ]);
      yield* pin(vault, "./Reports//Spending.html").pipe(Effect.flatMap(decode(PinNoteResponse)));
      const afterUnpin = yield* unpin(vault, "Projects/Plan.md").pipe(Effect.flatMap(decode(UnpinNoteResponse)));
      expect(afterUnpin.pins).toEqual([
        { path: "index.md", kind: "note", title: "Home" },
        { path: "Reports/Spending.html", kind: "page", title: "Spending.html" },
      ]);
      expect(yield* listPins(vault)).toEqual(afterUnpin);
    }),
  );

  it.effect("keeps pins separate per vault", () =>
    Effect.gen(function* () {
      const first = yield* newVault;
      const second = yield* newVault;
      yield* pin(first.vault, "index.md");
      expect((yield* listPins(second.vault)).pins).toEqual([]);
    }),
  );

  it.effect("shows a pinned file that was deleted as missing, and can still unpin it", () =>
    Effect.gen(function* () {
      const { vault, root } = yield* newVault;
      yield* pin(vault, "Projects/Plan.md");
      rmSync(join(root, "Projects/Plan.md"));
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: ["Projects/Plan.md"] });
      expect((yield* listPins(vault)).pins).toEqual([{ path: "Projects/Plan.md", kind: "note", title: null }]);
      const { pins } = yield* unpin(vault, "Projects/Plan.md").pipe(Effect.flatMap(decode(UnpinNoteResponse)));
      expect(pins).toEqual([]);
    }),
  );

  it.effect("refuses files that aren't in the vault, ignored names, and escaping paths", () =>
    Effect.gen(function* () {
      const { vault } = yield* newVault;
      expect((yield* pin(vault, "Missing.md")).status).toBe(404);
      expect((yield* pin(vault, ".obsidian/app.json")).status).toBe(400);
      expect((yield* pin(vault, "../outside/secret.md")).status).toBe(400);
      expect((yield* pin(vault, "")).status).toBe(400);
      expect((yield* unpin(vault, "../x.md")).status).toBe(400);
      expect((yield* HttpClient.get("/api/vaults/missing/pins")).status).toBe(404);
      expect((yield* listPins(vault)).pins).toEqual([]);
    }),
  );

  it.effect("blocks pinning from another origin", () =>
    Effect.gen(function* () {
      const { vault } = yield* newVault;
      const response = yield* HttpClient.execute(
        HttpClientRequest.post(pinsPath(vault)).pipe(
          HttpClientRequest.setHeader("origin", "https://evil.example"),
          HttpClientRequest.bodyJsonUnsafe({ path: "index.md" }),
        ),
      );
      expect(response.status).toBe(403);
    }),
  );
});

layer(TestApp)("note outline", (it) => {
  it.effect("returns the note's headings with the ids used in its HTML", () =>
    Effect.gen(function* () {
      const { vault } = yield* newVault;
      const note = yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=index.md`).pipe(Effect.flatMap(decode(GetNoteResponse)));
      expect(note.headings).toEqual([
        { depth: 1, text: "Welcome", id: "welcome" },
        { depth: 2, text: "Getting started", id: "getting-started" },
        { depth: 3, text: "Install", id: "install" },
        { depth: 2, text: "Getting started", id: "getting-started-1" },
      ]);
      expect(note.html).toContain('<h2 id="getting-started-1">');
    }),
  );
});
