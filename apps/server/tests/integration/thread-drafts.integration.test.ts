import { expect, layer } from "@effect/vitest";
import { GetDraftResponse } from "@wiki-agents/contracts/threads/get-draft/response";
import { SaveDraftResponse } from "@wiki-agents/contracts/threads/save-draft/response";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestApp } from "./infrastructure/test-app.js";
import { decode, getThread, newThread, newVault, send, sendOk } from "./infrastructure/threads.js";

const get = (id: string) => HttpClient.get(`/api/threads/${id}/draft`).pipe(Effect.flatMap(decode(GetDraftResponse)));
const put = (id: string, text: string, baseVersion = 0, writerId = "a", sequence = 1) =>
  HttpClient.execute(HttpClientRequest.put(`/api/threads/${id}/draft`).pipe(HttpClientRequest.bodyJsonUnsafe({ text, baseVersion, writerId, sequence })));
const save = (id: string, text: string, baseVersion = 0, writerId = "a", sequence = 1) => put(id, text, baseVersion, writerId, sequence).pipe(Effect.flatMap(decode(SaveDraftResponse)));

layer(TestApp)("thread drafts", (it) => {
  it.effect("saves exact text per thread without changing conversation activity", () => Effect.gen(function* () {
    const thread = yield* newThread((yield* newVault).id);
    const other = yield* newThread(thread.vaultId);
    expect((yield* get(thread.id)).draft).toEqual({ text: "", version: 0 });
    const text = "  An unfinished thought\nwith another line  ";
    yield* save(thread.id, text);
    expect((yield* get(thread.id)).draft).toEqual({ text, version: 1 });
    expect((yield* get(other.id)).draft.text).toBe("");
    expect((yield* getThread(thread.id)).thread).toEqual(thread);
    expect((yield* getThread(thread.id)).events).toEqual([]);
    yield* save(thread.id, "", 0, "a", 2);
    expect((yield* get(thread.id)).draft.text).toBe("");
  }));

  it.effect("ignores out-of-order saves and refuses stale writers from another device", () => Effect.gen(function* () {
    const thread = yield* newThread((yield* newVault).id);
    yield* save(thread.id, "latest", 0, "a", 2);
    yield* save(thread.id, "older", 0, "a", 1);
    expect((yield* get(thread.id)).draft.text).toBe("latest");
    expect((yield* put(thread.id, "stale device", 0, "b")).status).toBe(409);
    yield* save(thread.id, "other device", 1, "b");
    expect((yield* put(thread.id, "late unload", 0, "a", 3)).status).toBe(409);
    expect((yield* get(thread.id)).draft.text).toBe("other device");
  }));

  it.effect("clears an accepted message atomically and rejects delayed saves that would resurrect it", () => Effect.gen(function* () {
    const thread = yield* newThread((yield* newVault).id);
    yield* save(thread.id, "  hello  ");
    yield* sendOk(thread.id, "hello");
    expect((yield* get(thread.id)).draft.text).toBe("");
    expect((yield* put(thread.id, "  hello  ", 0, "a", 2)).status).toBe(409);
    const version = (yield* get(thread.id)).draft.version;
    yield* save(thread.id, "next thought", version, "b");
    expect((yield* send(thread.id, "next thought")).status).toBe(409);
    expect((yield* get(thread.id)).draft.text).toBe("next thought");
  }));

  it.effect("keeps a different draft when a message arrives from another tab", () => Effect.gen(function* () {
    const thread = yield* newThread((yield* newVault).id);
    yield* save(thread.id, "still composing");
    yield* sendOk(thread.id, "sent elsewhere");
    expect((yield* get(thread.id)).draft.text).toBe("still composing");
  }));

  it.effect("rejects unknown threads and invalid bodies", () => Effect.gen(function* () {
    expect((yield* HttpClient.get("/api/threads/missing/draft")).status).toBe(404);
    expect((yield* put("missing", "text")).status).toBe(404);
    const thread = yield* newThread((yield* newVault).id);
    expect((yield* put(thread.id, "text", -1)).status).toBe(400);
    expect((yield* put(thread.id, "x".repeat(100_001))).status).toBe(400);
    expect((yield* get(thread.id)).draft.text).toBe("");
  }));
});
