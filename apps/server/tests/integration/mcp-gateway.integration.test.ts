import { expect, layer } from "@effect/vitest";
import type { AgentInput, Autonomy } from "@wiki-agents/contracts/agents/model";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Effect, Exit, Fiber, Option, Scope } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { afterAll } from "vitest";
import { McpTokens } from "../../src/features/mcp/tokens.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { ThreadMcpRegistration } from "../../src/features/mcp/thread-mcp-registration.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { startStandInMcp } from "./infrastructure/stand-in-mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { answer, getThread, interrupt, newThread, newVaultWith, setAgent, watch } from "./infrastructure/threads.js";

const upstream = await startStandInMcp({ waitTool: true });
afterAll(() => upstream.close());
const save = (id: string, isDefault = false, url = upstream.url, access: Autonomy["read"] | null = null) =>
  HttpClient.execute(HttpClientRequest.put(`/api/mcp-servers/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({
    baseHash: null,
    server: { title: id, transport: { type: "http", url, headers: {} }, scope: "app", default: isDefault, access, oauth: null },
  }))).pipe(Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))));
const names = (mcp: Effect.Success<ReturnType<typeof mcpSession>>) =>
  mcp.rpc("tools/list").pipe(Effect.map(({ result }) => (result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)));
const open = Effect.gen(function* () {
  const vault = yield* newVaultWith({ "index.md": "# Home" });
  const thread = yield* newThread(vault.id);
  const access = yield* (yield* ThreadMcpRegistration).open({ threadId: thread.id, vaultId: vault.id });
  return { thread, access };
});

layer(TestApp)("MCP gateway", (it) => {
  it.effect("routes tools through /mcp, isolates each thread's selection and runs calls only in a turn", () => Effect.gen(function* () {
    yield* save("selected");
    const a = yield* open;
    const b = yield* open;
    const first = yield* a.access.current(["selected"]);
    expect(first.notices).toEqual([]);
    const mcpA = yield* mcpSession(first.entry.token);
    const mcpB = yield* mcpSession((yield* b.access.current([])).entry.token);
    expect(yield* names(mcpA)).toContain("selected__echo");
    expect(yield* names(mcpA)).toContain("selected__whoami");
    expect(yield* names(mcpB)).not.toContain("selected__echo");
    const sent = upstream.requests.filter(({ method }) => method === "tools/call").length;
    // No turn runs in thread a, so nothing checks or approves the call: it never reaches the server.
    expect(yield* mcpA.call("selected__echo", { text: "outside a turn" })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/running turn/) }] });
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

/** Writes agent `id`, giving it `servers` and `autonomy` on top of reading freely and asking for the rest. */
const agentWith = (id: string, servers: ReadonlyArray<string>, autonomy: Partial<Autonomy>) => Effect.gen(function* () {
  const agent: AgentInput = {
    name: id, description: "", provider: null, model: null, sources: [], mcp: [...servers],
    autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "deny", tools: "ask", subagents: "ask", ...autonomy },
    instructions: "Use the tools.",
  };
  const current = yield* HttpClient.get(`/api/agents/${id}`);
  const baseHash = current.status === 200 ? ((yield* current.json) as { hash: string }).hash : null;
  yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent, baseHash }))).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
});

/**
 * A thread whose agent has `servers` and `autonomy`, with a turn running (the replay
 * waits on a question nobody answers), and an MCP session for it.
 */
const inTurn = (servers: ReadonlyArray<string>, autonomy: Partial<Autonomy>) => Effect.gen(function* () {
  const vault = yield* newVaultWith({ "index.md": "# Home" });
  const thread = yield* newThread(vault.id);
  const agentId = `tools-${thread.id.slice(0, 8).toLowerCase()}`;
  yield* agentWith(agentId, servers, autonomy);
  yield* setAgent(thread.id, agentId);
  const events = yield* watch(thread.id);
  yield* (yield* ThreadActors).sendMessage(thread.id, "Ask me a question");
  yield* events.until(isQuestion);
  const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
  return { vault, thread, agentId, events, mcp };
});

const isQuestion = (event: ThreadEvent) => event._tag === "request.opened" && event.prompt._tag === "question";
const isToolRequest = (event: ThreadEvent) => event._tag === "request.opened" && event.requestId.startsWith("mcp-tool:");
const toolRequest = (events: ReadonlyArray<ThreadEvent>) => {
  const opened = events.find(isToolRequest);
  if (opened?._tag !== "request.opened") throw new Error("no tool call approval was opened");
  return opened;
};
const callsUpstream = () => upstream.requests.filter(({ method }) => method === "tools/call").length;
const textOf = (result: { readonly content: ReadonlyArray<{ readonly text: string }> }) => result.content[0]?.text ?? "";

layer(TestApp)("MCP gateway approvals", (it) => {
  it.effect("runs read-only tools on read autonomy and asks before the others, with server, tool and arguments", () => Effect.gen(function* () {
    yield* save("asking");
    const { thread, events, mcp } = yield* inTurn(["asking"], { tools: "ask", subagents: "ask" });
    expect(yield* mcp.call("asking__echo", { text: "no question" })).toMatchObject({ isError: false, content: [{ text: "no question" }] });

    const approved = yield* Effect.forkChild(mcp.call("asking__whoami", { reason: "check" }));
    const request = toolRequest(yield* events.until(isToolRequest, "0 seconds"));
    expect(request.prompt).toMatchObject({ _tag: "approval", title: "asking: whoami" });
    if (request.prompt._tag !== "approval") throw new Error("not an approval");
    expect(request.prompt.detail).toContain("MCP server asking, tool whoami.");
    expect(request.prompt.detail).toContain('"reason": "check"');
    yield* answer(thread.id, request.requestId, { _tag: "approval", decision: "approve" });
    expect(textOf(yield* Fiber.join(approved))).toBe("You sent nothing");

    const sent = callsUpstream();
    const denied = yield* Effect.forkChild(mcp.call("asking__whoami"));
    const second = toolRequest(yield* events.until(isToolRequest, "0 seconds"));
    yield* answer(thread.id, second.requestId, { _tag: "approval", decision: "deny" });
    const refused = yield* Fiber.join(denied);
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/You denied the call/);
    expect(callsUpstream()).toBe(sent);
    yield* interrupt(thread.id);
  }));

  it.effect("follows the agent's autonomy as it is now, and a server's access in place of it", () => Effect.gen(function* () {
    yield* save("plain");
    yield* save("locked", false, upstream.url, "deny");
    yield* save("trusted", false, upstream.url, "allow");
    const { thread, agentId, mcp } = yield* inTurn(["plain", "locked", "trusted"], { tools: "allow", subagents: "allow" });
    expect(textOf(yield* mcp.call("plain__whoami"))).toBe("You sent nothing");
    // Changed during the turn: the next call follows it.
    yield* agentWith(agentId, ["plain", "locked", "trusted"], { tools: "deny", subagents: "deny" });
    const sent = callsUpstream();
    const denied = yield* mcp.call("plain__whoami");
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toMatch(/denied by the agent's autonomy/);
    // `access: deny` refuses even a read-only tool the agent may use...
    expect((yield* mcp.call("locked__echo", { text: "no" })).isError).toBe(true);
    expect(callsUpstream()).toBe(sent);
    // ...and `access: allow` runs a tool the agent's own autonomy denies.
    expect(textOf(yield* mcp.call("trusted__whoami"))).toBe("You sent nothing");
    yield* interrupt(thread.id);
  }));

  it.effect("Stop refuses a call waiting for approval and cancels one already running", () => Effect.gen(function* () {
    yield* save("stopping");
    const first = yield* inTurn(["stopping"], { tools: "ask", subagents: "ask" });
    const pending = yield* Effect.forkChild(first.mcp.call("stopping__wait"));
    toolRequest(yield* first.events.until(isToolRequest, "0 seconds"));
    yield* interrupt(first.thread.id);
    expect(textOf(yield* Fiber.join(pending))).toMatch(/turn ended before the call was approved/);
    expect((yield* getThread(first.thread.id)).events.some(({ event }) => event._tag === "request.resolved" && event.answer === null)).toBe(true);

    const second = yield* inTurn(["stopping"], { tools: "allow", subagents: "allow" });
    const arrived = upstream.nextWait();
    const running = yield* Effect.forkChild(second.mcp.call("stopping__wait"));
    yield* Effect.promise(() => arrived);
    yield* interrupt(second.thread.id);
    const cancelled = yield* Fiber.join(running);
    expect(cancelled.isError).toBe(true);
    expect(textOf(cancelled)).toMatch(/turn ended, so the call to stopping was cancelled/);
    upstream.releaseWaits();
  }));

  it.effect("denies a call that would ask in an unattended run, and says so in the turn", () => Effect.gen(function* () {
    yield* save("unattended");
    const vault = yield* newVaultWith({ "index.md": "# Home" });
    const thread = yield* newThread(vault.id);
    const agentId = `tools-${thread.id.slice(0, 8).toLowerCase()}`;
    yield* agentWith(agentId, ["unattended"], { tools: "ask", subagents: "ask" });
    yield* setAgent(thread.id, agentId);
    yield* (yield* ThreadActors).sendMessage(thread.id, "long", [], { unattended: true });
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vault.id)).token);
    const sent = callsUpstream();
    expect(textOf(yield* mcp.call("unattended__whoami"))).toMatch(/Nobody is watching/);
    expect(callsUpstream()).toBe(sent);
    expect((yield* getThread(thread.id)).events.some(({ event }) => event._tag === "notice" && event.text.includes("“unattended: whoami” was denied"))).toBe(true);
    yield* interrupt(thread.id);
  }));
});
