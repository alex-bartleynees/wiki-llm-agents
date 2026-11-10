import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { ListNoteContextResponse } from "@wiki-agents/contracts/threads/list-note-context/response";
import { RelatedNotesResponse } from "@wiki-agents/contracts/notes/related-notes/response";
import { TestApp } from "./infrastructure/test-app.js";
import { newVaultWith, newThread, post, getThread, decode, watch, isTag } from "./infrastructure/threads.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
layer(TestApp)("note context", (it) => {
  it.effect("stores supplied and retrieved versions separately and scopes note-thread links to the vault", () => Effect.gen(function* () {
    const vault = yield* newVaultWith({ "Plan.md": "# Plan\n\nCurrent plan. [[Other]]\n\n## Selected\n\nSection fact.\n\n## Elsewhere\n\nDifferent fact.", "Other.md": "# Other" });
    const thread = yield* newThread(vault.id);
    const events = yield* watch(thread.id);
    expect((yield* post(`/api/threads/${thread.id}/messages`, { text: "Ask a question", notes: [{ path: "Plan.md", selection: "Current plan." }] })).status).toBe(202);
    yield* events.until(isTag("request.opened"));
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
    const read = yield* mcp.result<{ content: string; hash: string }>("vault_read_note", { path: "Plan.md" });
    expect(read.content).toContain("Current plan.");
    const stored = (yield* getThread(thread.id)).events.flatMap(({ event }) => event._tag === "note.context" ? [event.note] : []);
    expect(stored.map((note) => note.reason)).toEqual(["supplied", "retrieved"]);
    expect(stored[0]!.content).toBe("Current plan.");
    expect(stored[0]!.hash).toBe(read.hash);
    expect(read.hash).toMatch(/^[a-f0-9]{64}$/);
    const section = yield* mcp.result<{ content: string; hash: string }>("vault_read_note", { path: "Plan.md", heading: "Selected" });
    expect(section.content).toContain("Section fact.");
    expect(section.content).not.toContain("Different fact.");
    expect(section.hash).toBe(read.hash);
    expect((yield* mcp.call("vault_read_note", { path: "Plan.md", heading: "Missing" })).isError).toBe(true);
    const links = yield* HttpClient.get(`/api/vaults/${vault.id}/thread-notes?path=Plan.md`).pipe(Effect.flatMap(decode(ListNoteContextResponse)));
    expect(links.notes).toHaveLength(2);
    expect(links.notes.every((link) => link.threadId === thread.id)).toBe(true);
    const other = yield* newVaultWith({ "Plan.md": "# Secret" });
    expect((yield* HttpClient.get(`/api/vaults/${other.id}/thread-notes`).pipe(Effect.flatMap(decode(ListNoteContextResponse)))).notes).toEqual([]);
    const related = yield* HttpClient.get(`/api/vaults/${vault.id}/related?path=Plan.md`).pipe(Effect.flatMap(decode(RelatedNotesResponse)));
    expect(related.notes[0]?.path).toBe("Other.md");
    expect((yield* mcp.result<{ notes: ReadonlyArray<{ path: string }> }>("vault_related", { path: "Plan.md" })).notes[0]?.path).toBe("Other.md");
  }));
  it.effect("persists an explicit truncation notice with the bounded supplied context", () => Effect.gen(function* () {
    const vault = yield* newVaultWith({ "Large.md": "# Large\n\n" + "word ".repeat(4000) });
    const thread = yield* newThread(vault.id);
    yield* post(`/api/threads/${thread.id}/messages`, { text: "Ask a question", notes: [{ path: "Large.md" }] });
    const notes = (yield* getThread(thread.id)).events.flatMap(({ event }) => event._tag === "note.context" ? [event.note] : []);
    expect(notes[0]!.content).toHaveLength(16000);
    expect(notes[0]!.notices[0]).toContain("truncated");
  }));
  it.effect("rejects escaping paths, stale selections and oversized context without starting a turn", () => Effect.gen(function* () {
    const vault = yield* newVaultWith({ "Plan.md": "# Plan" });
    const thread = yield* newThread(vault.id);
    for (const notes of [[{ path: "../outside/secret.md" }], [{ path: "Plan.md", selection: "stale" }], Array.from({ length: 11 }, () => ({ path: "Plan.md" }))]) {
      expect((yield* post(`/api/threads/${thread.id}/messages`, { text: "hello", notes })).status).toBe(400);
    }
    expect((yield* getThread(thread.id)).events).toEqual([]);
  }));
});
