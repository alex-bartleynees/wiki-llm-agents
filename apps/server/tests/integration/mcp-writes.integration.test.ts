import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import type { AgentInput, AutonomyLevel, KnowledgeSource } from "@wiki-agents/contracts/agents/model";
import { Effect, Fiber } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { answer, getThread, interrupt, isTag, newThread, newVaultWith, requestIdOf, sendOk, setAgent, watch } from "./infrastructure/threads.js";

const source = "---\ntags: [test]\n---\n# Plan\n\n## Work\nOriginal.\n";
const agentWith = (id: string, permission: AutonomyLevel, sources: ReadonlyArray<KnowledgeSource> = []) => Effect.gen(function* () {
  const agent: AgentInput = { name: id, description: "", provider: null, model: null, sources, autonomy: { read: "allow", create: permission, edit: permission, commands: "deny", web: "deny" }, instructions: "Maintain notes." };
  const current = yield* HttpClient.get(`/api/agents/${id}`);
  const baseHash = current.status === 200 ? ((yield* current.json) as { hash: string }).hash : null;
  yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent, baseHash }))).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
});
const setup = (permission: AutonomyLevel = "allow") => Effect.gen(function* () {
  const vault = yield* newVaultWith({ "Notes/Plan.md": source, "Large.md": "# Large\n" + "a".repeat(17000), "AGENTS.md": "# Rules" });
  const thread = yield* newThread(vault.id);
  const agentId = `write-${thread.id.slice(0, 8).toLowerCase()}`;
  yield* agentWith(agentId, permission);
  yield* setAgent(thread.id, agentId);
  const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
  const events = yield* watch(thread.id);
  const turnId = yield* sendOk(thread.id, "Ask me a question");
  const questionId = requestIdOf(yield* events.until(isTag("request.opened")));
  return { vault, thread, agentId, mcp, events, turnId, questionId };
});

layer(TestApp)("vault create/edit tools", (it) => {
  it.effect("creates, reads, edits, refreshes the index, attributes changes and allows undo", () => Effect.gen(function* () {
    const { vault, thread, mcp, events, questionId, turnId } = yield* setup();
    const created = yield* mcp.result<{ hash: string }>("vault_create_note", { path: "Notes/New.md", content: "# New\n\n[[Plan]]" });
    const read = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/New.md" });
    expect(read.hash).toBe(created.hash);
    const edited = yield* mcp.result<{ hash: string }>("vault_edit_note", { path: "Notes/New.md", baseHash: read.hash, content: "# New\n\nZanzibar [[Plan]]" });
    expect(edited.hash).not.toBe(created.hash);
    expect((yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/New.md" })).hash).toBe(edited.hash);
    expect((yield* mcp.result<{ results: unknown[] }>("vault_search", { query: "zanzibar" })).results).toHaveLength(1);
    expect((yield* mcp.result<{ backlinks: unknown[] }>("vault_backlinks", { path: "Notes/Plan.md" })).backlinks).toHaveLength(1);
    yield* answer(thread.id, questionId, { _tag: "question", text: "Done" });
    yield* events.until(isTag("turn.finished"));
    const changes = (yield* getThread(thread.id)).events.map(({ event }) => event).find((event) => event._tag === "turn.changes");
    expect(changes).toMatchObject({ turnId, changes: [{ path: "Notes/New.md", attribution: "agent", change: "create" }] });
    if (changes?._tag !== "turn.changes") throw new Error("missing changes");
    const undo = yield* HttpClient.execute(HttpClientRequest.post(`/api/changes/${changes.changes[0]!.id}/undo`).pipe(HttpClientRequest.bodyJsonUnsafe({})));
    expect(undo.status).toBe(200);
    expect((yield* mcp.call("vault_note_info", { path: "Notes/New.md" })).isError).toBe(true);
    expect(readFileSync(join(vault.rootPath, "Notes/Plan.md"), "utf8")).toBe(source);
  }));

  it.effect("refuses collisions, stale hashes, unread, partial and truncated versions without overwriting", () => Effect.gen(function* () {
    const { mcp, vault } = yield* setup();
    expect((yield* mcp.call("vault_create_note", { path: "Notes/Plan.md", content: "lost" })).isError).toBe(true);
    const partial = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/Plan.md", heading: "Work" });
    expect((yield* mcp.call("vault_edit_note", { path: "Notes/Plan.md", content: "lost", baseHash: partial.hash })).content[0]?.text).toMatch(/complete/);
    const large = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Large.md" });
    expect((yield* mcp.call("vault_edit_note", { path: "Large.md", content: "lost", baseHash: large.hash })).content[0]?.text).toMatch(/complete/);
    const fullLarge = yield* mcp.result<{ hash: string; content: string; notices: unknown[] }>("vault_read_note", { path: "Large.md", full: true });
    expect(fullLarge.content.length).toBeGreaterThan(16000);
    expect(fullLarge.notices).toEqual([]);
    expect((yield* mcp.call("vault_edit_note", { path: "Large.md", content: fullLarge.content + "\nAddition.", baseHash: fullLarge.hash })).isError).toBe(false);
    const full = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/Plan.md" });
    writeFileSync(join(vault.rootPath, "Notes/Plan.md"), source + "Other writer.");
    expect((yield* mcp.call("vault_edit_note", { path: "Notes/Plan.md", content: "lost", baseHash: full.hash })).content[0]?.text).toMatch(/changed/);
    expect(readFileSync(join(vault.rootPath, "Notes/Plan.md"), "utf8")).toBe(source + "Other writer.");
  }));

  it.effect("checks current autonomy, scope, protected paths, traversal and symlinks", () => Effect.gen(function* () {
    const { mcp, vault, agentId } = yield* setup("deny");
    expect((yield* mcp.call("vault_create_note", { path: "New.md", content: "# New" })).content[0]?.text).toMatch(/denies/);
    yield* agentWith(agentId, "allow", [{ vault: vault.name, folders: ["Notes"] }]);
    expect((yield* mcp.call("vault_create_note", { path: "Private.md", content: "# New" })).isError).toBe(true);
    expect((yield* mcp.call("vault_create_note", { path: "Notes/New.md", content: "# New" })).isError).toBe(false);
    for (const path of ["../Outside.md", "/tmp/Outside.md", "Notes/.hidden.md", "Notes/AGENTS.md", "Notes/file.txt"]) expect((yield* mcp.call("vault_create_note", { path, content: "lost" })).isError).toBe(true);
    symlinkSync(join(vault.rootPath, "AGENTS.md"), join(vault.rootPath, "Notes/Alias.md"));
    const read = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/Alias.md" });
    expect((yield* mcp.call("vault_edit_note", { path: "Notes/Alias.md", baseHash: read.hash, content: "lost" })).isError).toBe(true);
    const other = yield* newVaultWith({ "Outside.md": "# Outside" });
    symlinkSync(other.rootPath, join(vault.rootPath, "Notes/Escape"));
    expect((yield* mcp.call("vault_create_note", { path: "Notes/Escape/New.md", content: "lost" })).isError).toBe(true);
    yield* agentWith(agentId, "allow", [{ vault: "Other vault", folders: [] }]);
    expect((yield* mcp.call("vault_create_note", { path: "Notes/Other.md", content: "lost" })).isError).toBe(true);
  }));

  it.effect("shows the exact diff, rechecks versions and permissions after approval, and cancels on interrupt", () => Effect.gen(function* () {
    const { mcp, thread, events, agentId, vault } = yield* setup("ask");
    for (const scenario of ["deny", "changed", "permission", "interrupt"]) {
      const content = `# ${scenario}\nExact proposal.\n`;
      const path = `Notes/${scenario}.md`;
      const fiber = yield* Effect.forkChild(mcp.call("vault_create_note", { path, content }));
      const seen = yield* events.until(isTag("request.opened"));
      const opened = seen.find((event) => event._tag === "request.opened");
      expect(opened).toMatchObject({ prompt: { _tag: "approval", edits: [{ path, patch: expect.stringContaining("+Exact proposal.") }] } });
      if (scenario === "changed") writeFileSync(join(vault.rootPath, path), "Someone else's creation.");
      if (scenario === "permission") yield* agentWith(agentId, "deny");
      if (scenario === "interrupt") yield* interrupt(thread.id);
      else yield* answer(thread.id, requestIdOf(seen), { _tag: "approval", decision: scenario === "deny" ? "deny" : "approve" });
      expect((yield* Fiber.join(fiber)).isError).toBe(true);
      yield* agentWith(agentId, "ask");
    }
  }));

  it.effect("supports explicit reciprocal links, index refresh and log append using tools alone", () => Effect.gen(function* () {
    const { mcp } = yield* setup();
    for (const [path, content] of [["Notes/Issue.md", "# Issue\n\n[[Plan]]"], ["index.md", "# Index\n\n[[Notes/Issue]]"], ["log.md", "# Log\n"]]) {
      yield* mcp.result("vault_create_note", { path, content });
    }
    for (const [path, addition] of [["Notes/Plan.md", "\n[[Issue]]"], ["log.md", "\n## Captured issue\nCreated [[Notes/Issue]].\n"]]) {
      const note = yield* mcp.result<{ hash: string; content: string }>("vault_read_note", { path, full: true });
      yield* mcp.result("vault_edit_note", { path, baseHash: note.hash, content: note.content + addition });
    }
    expect((yield* mcp.result<{ backlinks: unknown[] }>("vault_backlinks", { path: "Notes/Issue.md" })).backlinks).toHaveLength(3);
  }));

  it.effect("refuses approval-dependent writes in unattended turns", () => Effect.gen(function* () {
    const vault = yield* newVaultWith({ "index.md": "# Index" });
    const thread = yield* newThread(vault.id);
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
    yield* (yield* ThreadActors).sendMessage(thread.id, "long", [], { unattended: true });
    expect((yield* mcp.call("vault_create_note", { path: "Unattended.md", content: "# No" })).content[0]?.text).toMatch(/Nobody is watching/);
    yield* interrupt(thread.id);
  }));

  it.effect("approval commits an exact edit and returns a receipt", () => Effect.gen(function* () {
    const { mcp, thread, events } = yield* setup("ask");
    const { hash } = yield* mcp.result<{ hash: string }>("vault_read_note", { path: "Notes/Plan.md" });
    const fiber = yield* Effect.forkChild(mcp.result("vault_edit_note", { path: "Notes/Plan.md", baseHash: hash, content: source + "Approved.\n" }));
    const seen = yield* events.until(isTag("request.opened"));
    yield* answer(thread.id, requestIdOf(seen), { _tag: "approval", decision: "approve" });
    expect(yield* Fiber.join(fiber)).toMatchObject({ path: "Notes/Plan.md", hash: expect.any(String), notices: [] });
    expect((yield* getThread(thread.id)).events.some(({ event }) => event._tag === "notice" && event.text.startsWith("Edited Notes/Plan.md (sha256"))).toBe(true);
  }));
});
