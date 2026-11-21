import { expect, layer } from "@effect/vitest";
import { DEFAULT_AUTONOMY, type AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, Fiber } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { TestApp } from "./infrastructure/test-app.js";
import { answer, getThread, isTag, newThread, newVault, requestIdOf, sendOk, setAgent, watch } from "./infrastructure/threads.js";

const setup = Effect.fnUntraced(function* (permission: AutonomyLevel) {
  const vault = yield* newVault;
  const manager = yield* newThread(vault.id);
  const agentId = `manager-${manager.id.slice(0, 8)}`;
  const agent = {
    name: agentId, description: "", provider: null, model: null, sources: [], mcp: [],
    autonomy: { ...DEFAULT_AUTONOMY, threads: permission },
    instructions: "Manage child threads.",
  };
  yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${agentId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe({ agent, baseHash: null }),
  )).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  yield* setAgent(manager.id, agentId);
  const mcp = yield* mcpSession((yield* tokenFor(manager.id, vault.id)).token);
  const events = yield* watch(manager.id);
  yield* sendOk(manager.id, "Ask me a question");
  yield* events.until(isTag("request.opened"));
  return { vault, manager, mcp, events, agentId };
});

const task = { title: "Read the plan", prompt: "Ask me a question" };

layer(TestApp)("manager thread tools", (it) => {
  it.effect("checks ownership, runs children as app threads, and limits concurrent work", () => Effect.gen(function* () {
    const { vault, manager, mcp, agentId } = yield* setup("allow");
    const available = yield* mcp.rpc("tools/list");
    expect(available.result).toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "thread_create" })]) });
    const child = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", task);
    const events = yield* watch(child.threadId);
    const detail = yield* getThread(child.threadId);
    expect(detail.thread).toMatchObject({ parentThreadId: manager.id, agentId, title: task.title, vaultId: vault.id });
    const childMcp = yield* mcpSession((yield* tokenFor(child.threadId, vault.id)).token);
    const childTools = yield* childMcp.rpc("tools/list");
    expect(childTools.result).not.toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "thread_create" })]) });
    expect(yield* childMcp.callError("thread_create", task)).toBeTruthy();
    expect((yield* mcp.call("thread_read", { threadId: manager.id })).isError).toBe(true);
    expect((yield* mcp.call("thread_send", { threadId: child.threadId, prompt: "Try again" })).isError).toBe(true);
    const others = yield* Effect.forEach([1, 2, 3, 4], () => mcp.call("thread_create", task), { concurrency: "unbounded" });
    expect(others.filter((result) => !result.isError)).toHaveLength(3);

    const pending = yield* events.until(isTag("request.opened"));
    yield* answer(child.threadId, requestIdOf(pending), { _tag: "question", text: "_Inbox/" });
    yield* events.until(isTag("turn.finished"));
    expect(yield* mcp.result("thread_read", { threadId: child.threadId })).toMatchObject({ reply: expect.stringContaining("_Inbox/"), outcome: "completed" });
    expect(yield* mcp.result("thread_send", { threadId: child.threadId, prompt: task.prompt })).toMatchObject({ threadId: child.threadId });
    expect(yield* mcp.result("thread_list")).toMatchObject({ children: expect.arrayContaining([expect.objectContaining({ threadId: child.threadId })]) });
  }));

  it.effect("asks before creating a child and leaves the list empty when denied", () => Effect.gen(function* () {
    const { manager, mcp, events } = yield* setup("ask");
    const pending = yield* Effect.forkChild(mcp.call("thread_create", task));
    const seen = yield* events.until(isTag("request.opened"));
    expect(seen.find(isTag("request.opened"))).toMatchObject({
      prompt: { title: "Start child thread", detail: expect.stringContaining(task.prompt) },
    });
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "deny" });
    expect((yield* Fiber.join(pending)).isError).toBe(true);
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }));
});
