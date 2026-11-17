import { expect, layer } from "@effect/vitest";
import { Effect, Exit, Option, Scope } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { afterAll } from "vitest";
import { McpTokens } from "../../src/features/mcp/tokens.js";
import { VaultTools } from "../../src/features/mcp/vault-tools.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { startStandInMcp } from "./infrastructure/stand-in-mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { newThread, newVaultWith } from "./infrastructure/threads.js";

const upstream = await startStandInMcp();
afterAll(() => upstream.close());
const save = (id: string, isDefault = false, url = upstream.url) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({
    baseHash: null,
    server: { title: id, transport: { type: "http", url, headers: {} }, scope: "app", default: isDefault, access: null, oauth: null },
  }))).pipe(Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))));
const names = (mcp: Effect.Success<ReturnType<typeof mcpSession>>) =>
  mcp.rpc("tools/list").pipe(Effect.map(({ result }) => (result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)));
const open = Effect.gen(function* () {
  const vault = yield* newVaultWith({ "index.md": "# Home" });
  const thread = yield* newThread(vault.id);
  const access = yield* (yield* VaultTools).open({ threadId: thread.id, vaultId: vault.id });
  return { thread, access };
});

layer(TestApp)("MCP gateway", (it) => {
  it.effect("routes read-only tools through /mcp and isolates each thread's selection", () => Effect.gen(function* () {
    yield* save("selected");
    const a = yield* open;
    const b = yield* open;
    const first = yield* a.access.current(["selected"]);
    expect(first.notices.join(" ")).toContain("doesn't mark it read-only");
    const mcpA = yield* mcpSession(first.entry.token);
    const mcpB = yield* mcpSession((yield* b.access.current([])).entry.token);
    expect(yield* names(mcpA)).toContain("selected__echo");
    expect(yield* names(mcpA)).not.toContain("selected__whoami");
    expect(yield* names(mcpB)).not.toContain("selected__echo");
    expect(yield* mcpA.call("selected__echo", { text: "through the gateway" })).toMatchObject({ content: [{ type: "text", text: "through the gateway" }] });
    const sent = upstream.requests.filter(({ method }) => method === "tools/call").length;
    yield* mcpB.rpc("tools/call", { name: "selected__echo", arguments: { text: "hidden" } });
    expect(upstream.requests.filter(({ method }) => method === "tools/call")).toHaveLength(sent);
    const next = yield* a.access.current([]);
    expect(next.entry.revision).toBe(first.entry.revision + 1);
    expect(next.entry.token).not.toBe(first.entry.token);
    expect(Option.isNone(yield* (yield* McpTokens).verify(first.entry.token))).toBe(true);
    expect(yield* names(yield* mcpSession(next.entry.token))).not.toContain("selected__echo");
    const restored = yield* a.access.current(["selected"]);
    expect(restored.entry.revision).toBe(next.entry.revision + 1);
    expect((yield* a.access.current(["selected"])).entry).toEqual(restored.entry);
  }));

  it.effect("includes default servers and removes visibility and tokens when the owner scope closes", () => Effect.gen(function* () {
    yield* save("global", true);
    const scope = yield* Scope.make();
    const { access } = yield* open.pipe(Scope.provide(scope));
    const { entry } = yield* access.current([]);
    const mcp = yield* mcpSession(entry.token);
    expect(yield* names(mcp)).toContain("global__echo");
    yield* Scope.close(scope, Exit.void);
    expect(Option.isNone(yield* (yield* McpTokens).verify(entry.token))).toBe(true);

  }));

  it.effect("keeps other tools available when a server fails, and recovers on the next turn after restart", () => Effect.gen(function* () {
    upstream.setDown(true);
    yield* save("recovering");
    const { access } = yield* open;
    const first = yield* access.current(["recovering", "not-configured"]);
    expect(first.notices.join(" ")).toContain("not-configured");
    expect(first.notices.join(" ")).toContain("503");
    expect(yield* names(yield* mcpSession(first.entry.token))).toContain("vault_search");
    upstream.setDown(false);
    const restarted = yield* HttpClient.execute(HttpClientRequest.post("/api/mcp-servers/recovering/restart"));
    expect(restarted.status).toBe(200);
    const next = yield* access.current(["recovering"]);
    expect(next.entry.revision).toBe(first.entry.revision + 1);
    expect(yield* names(yield* mcpSession(next.entry.token))).toContain("recovering__echo");
  }));
});
