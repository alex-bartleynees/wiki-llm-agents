import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The thread list and the open thread with real Svelte state in a real browser; only
 * the API and the event streams are stand-ins, so tests decide when answers arrive.
 */

const api = vi.hoisted(() => ({
  listThreads: vi.fn(),
  getThread: vi.fn(),
  createThread: vi.fn(),
  markDone: vi.fn(),
  reopenThread: vi.fn(),
}));
vi.mock("./api.ts", () => ({
  ...api,
  vaultThreadsEventsPath: (vaultId: string) => `/events/vaults/${vaultId}/threads`,
  threadEventsPath: (threadId: string) => `/events/threads/${threadId}`,
  answerRequest: vi.fn(),
  interruptTurn: vi.fn(),
  sendMessage: vi.fn(),
  listProviders: vi.fn(),
  getProviderStatus: vi.fn(),
}));

/** Each stream opened, so a test can send it messages. */
const streams = vi.hoisted(() => [] as Array<{ path: string; onEvent: (message: unknown) => void; closed: boolean }>);
vi.mock("#lib/api/sse.ts", () => ({
  listen: (path: string | (() => string), _schema: unknown, handlers: { onEvent: (message: unknown) => void }) => {
    const stream = { path: typeof path === "string" ? path : path(), onEvent: handlers.onEvent, closed: false };
    streams.push(stream);
    return () => {
      stream.closed = true;
    };
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

const { threads } = await import("./threads.svelte.ts");
const { openThread } = await import("./open-thread.svelte.ts");

const summary = (id: string, projectId: string | null, vaultId = "v1"): ThreadSummary => ({
  id,
  vaultId,
  projectId,
  title: id,
  providerInstanceId: "replay",
  model: null,
  agentId: null,
  status: "idle",
  doneAt: null,
  lastSeq: 0,
  createdAt: 1,
  updatedAt: 1,
});

/** A promise the test resolves when it wants the answer to arrive. */
const later = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => (resolve = done));
  return { promise, resolve };
};

const ids = () => threads.threads.map((thread) => thread.id);

beforeEach(() => {
  localStorage.clear();
  streams.length = 0;
  api.listThreads.mockReset();
  api.getThread.mockReset();
  api.getThread.mockImplementation(async (threadId: string) => ({ thread: summary(threadId, null), events: [] }));
});

afterEach(() => threads.disconnect());

describe("thread list scope", () => {
  it("lists all of a vault's threads, or only one project's", async () => {
    api.listThreads.mockImplementation(async (_vaultId: string, projectId: string | null) => ({
      threads: projectId === null ? [summary("a", null), summary("b", "p1")] : [summary("b", "p1")],
    }));
    await threads.connect({ vaultId: "v1", projectId: null });
    expect(ids()).toEqual(["a", "b"]);
    expect(api.listThreads).toHaveBeenLastCalledWith("v1", null, expect.anything());

    await threads.connect({ vaultId: "v1", projectId: "p1" });
    expect(ids()).toEqual(["b"]);
    expect(api.listThreads).toHaveBeenLastCalledWith("v1", "p1", expect.anything());
  });

  it("keeps the list it switched to when an earlier list answers last", async () => {
    const all = later<{ threads: Array<ThreadSummary> }>();
    const project = later<{ threads: Array<ThreadSummary> }>();
    api.listThreads.mockImplementation((_vaultId: string, projectId: string | null) => (projectId === null ? all.promise : project.promise));

    const allLoaded = threads.connect({ vaultId: "v1", projectId: null });
    const projectLoaded = threads.connect({ vaultId: "v1", projectId: "p1" });
    project.resolve({ threads: [summary("b", "p1")] });
    await projectLoaded;
    all.resolve({ threads: [summary("a", null), summary("b", "p1")] });
    await allLoaded;
    expect(ids()).toEqual(["b"]);
  });

  it("adds live updates only for threads in the scope shown", async () => {
    api.listThreads.mockResolvedValue({ threads: [] });
    await threads.connect({ vaultId: "v1", projectId: "p1" });
    const stream = streams.find((candidate) => candidate.path === "/events/vaults/v1/threads" && !candidate.closed)!;
    stream.onEvent({ type: "thread.updated", thread: summary("vault-thread", null) });
    stream.onEvent({ type: "thread.updated", thread: summary("other-project", "p2") });
    stream.onEvent({ type: "thread.updated", thread: summary("mine", "p1") });
    expect(ids()).toEqual(["mine"]);
  });

  it("reopens the thread last open in each project", async () => {
    api.listThreads.mockImplementation(async (_vaultId: string, projectId: string | null) => ({
      threads: projectId === "p1" ? [summary("one", "p1")] : projectId === "p2" ? [summary("two", "p2")] : [],
    }));
    await threads.show({ vaultId: "v1", projectId: "p1" }, "one");
    await threads.show({ vaultId: "v1", projectId: "p2" }, "two");

    await threads.connect({ vaultId: "v1", projectId: "p1" });
    expect(openThread.threadId).toBe("one");
    await threads.connect({ vaultId: "v1", projectId: "p2" });
    expect(openThread.threadId).toBe("two");
  });
});

describe("open thread", () => {
  it("shows the thread opened last when an earlier one loads after it", async () => {
    const first = later<{ thread: ThreadSummary; events: [] }>();
    const second = later<{ thread: ThreadSummary; events: [] }>();
    api.getThread.mockImplementation((threadId: string) => (threadId === "first" ? first.promise : second.promise));

    const openingFirst = openThread.open("first");
    const openingSecond = openThread.open("second");
    second.resolve({ thread: summary("second", null), events: [] });
    await openingSecond;
    first.resolve({ thread: summary("first", null), events: [] });
    await openingFirst;
    expect(openThread.thread?.id).toBe("second");
    expect(openThread.status).toBe("loaded");
  });
});

describe("done threads", () => {
  const done = (id: string, doneAt: number, updatedAt = 1): ThreadSummary => ({ ...summary(id, null), doneAt, updatedAt });
  const openIds = () => threads.open.map((thread) => thread.id);
  const doneIds = () => threads.done.map((thread) => thread.id);

  it("splits the list into open threads and done ones, most recently done first", async () => {
    api.listThreads.mockResolvedValue({ threads: [summary("open", null), done("older", 10, 5), done("newer", 20, 2)] });
    await threads.connect({ vaultId: "v1", projectId: null });
    expect(openIds()).toEqual(["open"]);
    expect(doneIds()).toEqual(["newer", "older"]);
  });

  it("moves a thread between the groups when it is marked done or reopened", async () => {
    api.listThreads.mockResolvedValue({ threads: [summary("a", null)] });
    await threads.connect({ vaultId: "v1", projectId: null });
    await threads.select("a");

    api.markDone.mockResolvedValue({ thread: done("a", 30) });
    await threads.setDone("a", true);
    expect(api.markDone).toHaveBeenCalledWith("a");
    expect([openIds(), doneIds()]).toEqual([[], ["a"]]);
    expect(openThread.thread?.doneAt).toBe(30);

    api.reopenThread.mockResolvedValue({ thread: summary("a", null) });
    await threads.setDone("a", false);
    expect([openIds(), doneIds()]).toEqual([["a"], []]);
    expect(openThread.thread?.doneAt).toBeNull();
  });

  it("shows why a thread couldn't be marked done, and leaves it open", async () => {
    api.listThreads.mockResolvedValue({ threads: [summary("a", null)] });
    await threads.connect({ vaultId: "v1", projectId: null });
    await threads.select("a");
    api.markDone.mockRejectedValue(new Error("Stop the turn or answer it before marking the thread done"));
    await threads.setDone("a", true);
    expect(openThread.error).toContain("Stop the turn");
    expect(openIds()).toEqual(["a"]);
  });

  it("moves a done thread back to the open ones when another device sends it a message", async () => {
    api.listThreads.mockResolvedValue({ threads: [done("a", 10)] });
    await threads.connect({ vaultId: "v1", projectId: null });
    const stream = streams.find((candidate) => candidate.path === "/events/vaults/v1/threads" && !candidate.closed)!;
    stream.onEvent({ type: "thread.updated", thread: { ...summary("a", null), status: "running", updatedAt: 40 } });
    expect([openIds(), doneIds()]).toEqual([["a"], []]);
  });
});
