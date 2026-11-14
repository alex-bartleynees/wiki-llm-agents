import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The running store with real Svelte state; the API and the event stream are stand-ins. */

const api = vi.hoisted(() => ({ ALL_THREADS_TOPIC: { type: "all-threads" }, listActiveThreads: vi.fn() }));
vi.mock("./api.ts", () => api);

const stream = vi.hoisted(() => ({ handlers: undefined as { onEvent: (event: unknown) => void; onReconnect?: () => void } | undefined }));
vi.mock("#lib/api/sse.ts", () => ({
  listen: (_topic: unknown, _schema: unknown, handlers: typeof stream.handlers) => {
    stream.handlers = handlers;
    return () => (stream.handlers = undefined);
  },
}));

const { running } = await import("./running.svelte.ts");

const thread = (id: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  vaultId: "v1",
  projectId: null,
  title: id,
  providerInstanceId: "replay",
  model: null,
  agentId: null,
  status: "running",
  runningTurn: { startedAt: 1, progress: null },
  lastTurn: null,
  doneAt: null,
  lastSeq: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});
const failed = (id: string, overrides: Partial<ThreadSummary> = {}) =>
  thread(id, { status: "idle", runningTurn: null, lastTurn: { outcome: "failed", reason: "Broke", endedAt: Date.now() }, ...overrides });
const finished = (id: string) => thread(id, { status: "idle", runningTurn: null, lastTurn: { outcome: "completed", reason: null, endedAt: Date.now() } });
const updated = (summary: ThreadSummary) => stream.handlers?.onEvent({ type: "thread.updated", thread: summary });

beforeEach(() => {
  running.stop();
  running.threads = [];
  running.status = "loading";
  running.error = null;
  api.listActiveThreads.mockReset();
});

describe("running threads", () => {
  it("groups threads by what they need, and keeps the groups live from the stream", async () => {
    api.listActiveThreads.mockResolvedValue({ threads: [thread("a"), thread("b", { status: "waiting" }), failed("c")] });
    running.start();
    await vi.waitFor(() => expect(running.status).toBe("loaded"));
    expect([running.working, running.waiting, running.stopped].map((group) => group.map((item) => item.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(running.count).toBe(3);

    updated(finished("a"));
    updated(thread("d", { vaultId: "v2", runningTurn: { startedAt: 2, progress: { done: 1, total: 3, current: "Write" } } }));
    updated(failed("c", { doneAt: 5 }));
    expect(running.working.map((item) => item.id)).toEqual(["d"]);
    expect(running.working[0]?.runningTurn?.progress?.current).toBe("Write");
    expect(running.stopped).toEqual([]);
    expect(running.count).toBe(2);
  });

  it("keeps updates that arrive while the list loads, over the list's older answer", async () => {
    let answer: (value: { threads: ReadonlyArray<ThreadSummary> }) => void = () => {};
    api.listActiveThreads.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    running.start();
    updated(finished("a"));
    updated(thread("b", { status: "waiting" }));
    answer({ threads: [thread("a"), thread("b")] });
    await vi.waitFor(() => expect(running.status).toBe("loaded"));
    expect(running.threads.map((item) => [item.id, item.status])).toEqual([["b", "waiting"]]);
  });

  it("reloads after the stream reconnects", async () => {
    api.listActiveThreads.mockResolvedValueOnce({ threads: [thread("a")] }).mockResolvedValueOnce({ threads: [] });
    running.start();
    await vi.waitFor(() => expect(running.working).toHaveLength(1));
    stream.handlers?.onReconnect?.();
    await vi.waitFor(() => expect(running.working).toEqual([]));
  });
});
