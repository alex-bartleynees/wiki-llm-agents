import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import { GetTreeResponse } from "@wiki-agents/contracts/notes/get-tree/response";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Indexer } from "../../src/features/indexing/indexer.js";
import { TestApp } from "./infrastructure/test-app.js";
import { decode, isTag, newThread, newVaultWith, sendOk, watch } from "./infrastructure/threads.js";

layer(TestApp)("HTTP compression and conditional ETags", (it) => {
  it.effect("compresses large JSON responses with br or gzip and never compresses SSE", () =>
    Effect.gen(function* () {
      const largeBody = "Alpha beta gamma delta epsilon.\n".repeat(120);
      const vault = yield* newVaultWith({ "Large.md": `# Large\n\n${largeBody}` });

      const brResponse = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/note?path=Large.md`).pipe(
          HttpClientRequest.setHeader("accept-encoding", "gzip, br"),
        ),
      );
      expect(brResponse.status).toBe(200);
      expect(brResponse.headers["content-encoding"]).toBe("br");
      expect(brResponse.headers["vary"]).toContain("Accept-Encoding");
      expect(brResponse.headers["etag"]).toMatch(/^W\/"/);
      const decodedBr = yield* HttpClientResponse.schemaBodyJson(GetNoteResponse)(brResponse);
      expect(decodedBr.title).toBe("Large");

      const gzResponse = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/note?path=Large.md`).pipe(
          HttpClientRequest.setHeader("accept-encoding", "gzip, br;q=0"),
        ),
      );
      expect(gzResponse.status).toBe(200);
      expect(gzResponse.headers["content-encoding"]).toBe("gzip");
      const decodedGz = yield* HttpClientResponse.schemaBodyJson(GetNoteResponse)(gzResponse);
      expect(decodedGz.title).toBe("Large");

      const sse = yield* HttpClient.execute(
        HttpClientRequest.get("/events").pipe(HttpClientRequest.setHeader("accept-encoding", "br, gzip")),
      );
      expect(sse.status).toBe(200);
      expect(sse.headers["content-encoding"]).toBeUndefined();
      const firstChunk = yield* sse.stream.pipe(Stream.decodeText, Stream.take(1), Stream.runCollect);
      expect(firstChunk.join("")).toContain("connected");
    }),
  );

  it.effect("returns 304 Not Modified on matching ETags for get-tree, get-note, and get-thread", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Note.md": "# Note\n\nBody text." });
      const indexer = yield* Indexer;

      const tree1 = yield* HttpClient.get(`/api/vaults/${vault.id}/tree`);
      expect(tree1.status).toBe(200);
      const treeEtag = tree1.headers["etag"];
      expect(treeEtag).toBeDefined();
      expect((yield* decode(GetTreeResponse)(tree1)).entries).toHaveLength(1);

      const tree304 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/tree`).pipe(HttpClientRequest.setHeader("if-none-match", treeEtag!)),
      );
      expect(tree304.status).toBe(304);

      writeFileSync(join(vault.rootPath, "Second.md"), "# Second");
      yield* indexer.run({ _tag: "Sync", vault, paths: ["Second.md"] });
      const tree2 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/tree`).pipe(HttpClientRequest.setHeader("if-none-match", treeEtag!)),
      );
      expect(tree2.status).toBe(200);
      expect(tree2.headers["etag"]).not.toBe(treeEtag);

      const note1 = yield* HttpClient.get(`/api/vaults/${vault.id}/note?path=Note.md`);
      expect(note1.status).toBe(200);
      const noteEtag = note1.headers["etag"];
      expect(noteEtag).toBeDefined();
      const note304 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/note?path=Note.md`).pipe(HttpClientRequest.setHeader("if-none-match", noteEtag!)),
      );
      expect(note304.status).toBe(304);

      writeFileSync(join(vault.rootPath, "Note.md"), "# Note\n\nUpdated body text.");
      const note2 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/vaults/${vault.id}/note?path=Note.md`).pipe(HttpClientRequest.setHeader("if-none-match", noteEtag!)),
      );
      expect(note2.status).toBe(200);
      expect(note2.headers["etag"]).not.toBe(noteEtag);

      const thread = yield* newThread(vault.id);
      const thread1 = yield* HttpClient.get(`/api/threads/${thread.id}`);
      expect(thread1.status).toBe(200);
      const threadEtag = thread1.headers["etag"];
      expect(threadEtag).toBeDefined();
      expect((yield* decode(GetThreadResponse)(thread1)).events).toEqual([]);

      const thread304 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/threads/${thread.id}`).pipe(HttpClientRequest.setHeader("if-none-match", threadEtag!)),
      );
      expect(thread304.status).toBe(304);

      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      yield* events.until(isTag("turn.finished"));

      const thread2 = yield* HttpClient.execute(
        HttpClientRequest.get(`/api/threads/${thread.id}`).pipe(HttpClientRequest.setHeader("if-none-match", threadEtag!)),
      );
      expect(thread2.status).toBe(200);
      expect(thread2.headers["etag"]).not.toBe(threadEtag);
    }),
  );
});
