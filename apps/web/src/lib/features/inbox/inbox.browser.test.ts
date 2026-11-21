import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The inbox store with real Svelte state; the API and the event stream are stand-ins. */

const api = vi.hoisted(() => ({
  INBOX_TOPIC: { type: "inbox" },
  listInbox: vi.fn(),
  markRead: vi.fn(),
  markAllDone: vi.fn(),
  snoozeItem: vi.fn(),
  dismissItem: vi.fn(),
  markItemDone: vi.fn(),
}));
vi.mock("./api.ts", () => api);

const stream = vi.hoisted(() => ({ handlers: undefined as { onEvent: (event: unknown) => void; onReconnect?: () => void } | undefined }));
vi.mock("#lib/api/sse.ts", () => ({
  listen: (_topic: unknown, _schema: unknown, handlers: typeof stream.handlers) => {
    stream.handlers = handlers;
    return () => (stream.handlers = undefined);
  },
}));

const { inbox } = await import("./inbox.svelte.ts");

const item = (id: string, overrides: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: "reminder",
  title: id,
  body: "",
  state: "open",
  read: false,
  overdue: false,
  snoozedUntil: null,
  resolution: null,
  source: { vaultId: null, threadId: null, turnId: null, requestId: null, scheduleId: null, notePath: null },
  deliveries: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(() => {
  inbox.stop();
  inbox.items = [];
  inbox.status = "loading";
  inbox.error = null;
  for (const mock of [api.listInbox, api.markRead, api.markAllDone, api.snoozeItem, api.dismissItem, api.markItemDone]) mock.mockReset();
});

describe("inbox", () => {
  it("counts open, unread, unsnoozed items, and keeps the count live from the stream", async () => {
    api.listInbox.mockResolvedValue({ items: [item("a"), item("b", { read: true }), item("c", { snoozedUntil: 99 }), item("d", { state: "done" })] });
    inbox.start();
    await vi.waitFor(() => expect(inbox.status).toBe("loaded"));
    expect(inbox.unread).toBe(1);
    expect(inbox.open.map((open) => open.id)).toEqual(["a", "b"]);
    expect(inbox.snoozed.map((snoozed) => snoozed.id)).toEqual(["c"]);
    expect(inbox.history.map((closed) => closed.id)).toEqual(["d"]);

    stream.handlers!.onEvent({ type: "item.updated", item: item("e", { updatedAt: 5 }) });
    stream.handlers!.onEvent({ type: "item.updated", item: item("c", { updatedAt: 6 }) });
    expect(inbox.unread).toBe(3);
    expect(inbox.open.map((open) => open.id)).toEqual(["c", "e", "a", "b"]);
  });

  it("marks only unread items read, and reloads after a reconnect", async () => {
    api.listInbox.mockResolvedValue({ items: [item("a"), item("b", { read: true })] });
    inbox.start();
    await vi.waitFor(() => expect(inbox.status).toBe("loaded"));
    api.markRead.mockResolvedValue({ items: [item("a", { read: true, updatedAt: 2 })] });
    await inbox.read(["a", "b"]);
    expect(api.markRead).toHaveBeenCalledWith(["a"]);
    expect(inbox.unread).toBe(0);

    api.listInbox.mockResolvedValue({ items: [item("a", { read: true }), item("z")] });
    stream.handlers!.onReconnect!();
    await vi.waitFor(() => expect(inbox.unread).toBe(1));
  });

  it("keeps completion and a newer turn when a mark-read response arrives late", async () => {
    const older = item("a");
    const previousTurn = item("turn", { kind: "turn.finished", source: { ...older.source, turnId: "old" } });
    api.listInbox.mockResolvedValue({ items: [older, previousTurn] });
    inbox.start();
    await vi.waitFor(() => expect(inbox.status).toBe("loaded"));
    const read = Promise.withResolvers<{ items: InboxItem[] }>();
    const bulk = Promise.withResolvers<{ items: InboxItem[] }>();
    api.markRead.mockReturnValue(read.promise);
    api.markAllDone.mockReturnValue(bulk.promise);
    const reading = inbox.read(["a", "turn"]);
    const completing = inbox.completeAll([{ itemId: "a", turnId: null }, { itemId: "turn", turnId: "old" }]);
    const emit = (updated: InboxItem) => stream.handlers!.onEvent({ type: "item.updated", item: updated });
    emit(item("arrival"));
    emit({ ...previousTurn, updatedAt: 3, source: { ...previousTurn.source, turnId: "new" } });
    const done = item("a", { state: "done", read: true, updatedAt: 3 });
    emit({ ...done, deliveries: [{ channel: "in-app", status: "sent", attempts: 1, lastError: null, detail: null, sentAt: 1 }] });
    bulk.resolve({ items: [done] });
    expect(await completing).toBe(1);
    read.resolve({ items: [item("a", { updatedAt: 2, read: true }), { ...previousTurn, updatedAt: 2, read: true }] });
    await reading;
    expect(inbox.open.map(({ id, source, read }) => [id, source.turnId, read])).toEqual([
      ["turn", "new", false],
      ["arrival", null, false],
    ]);
    expect(inbox.history[0]?.deliveries).toHaveLength(1);
  });

  it("keeps committed updates and arrivals while a reconnect snapshot is in flight", async () => {
    const older = item("a");
    api.listInbox.mockResolvedValue({ items: [older] });
    inbox.start();
    await vi.waitFor(() => expect(inbox.status).toBe("loaded"));
    const snapshot = Promise.withResolvers<{ items: InboxItem[] }>();
    api.listInbox.mockReturnValue(snapshot.promise);
    const loading = inbox.load();
    const done = item("a", { state: "done", updatedAt: 2 });
    api.markAllDone.mockResolvedValue({ items: [done] });
    expect(await inbox.completeAll([{ itemId: "a", turnId: null }])).toBe(1);
    stream.handlers!.onEvent({ type: "item.updated", item: item("arrival") });
    snapshot.resolve({ items: [older] });
    await loading;
    expect(inbox.open.map(({ id }) => id)).toEqual(["arrival"]);
    expect(inbox.history).toEqual([done]);
  });

  it("ignores a completion response older than the state fetched on reconnect", async () => {
    const original = item("a");
    api.listInbox.mockResolvedValue({ items: [original] });
    inbox.start();
    await vi.waitFor(() => expect(inbox.status).toBe("loaded"));
    const bulk = Promise.withResolvers<{ items: InboxItem[] }>();
    api.markAllDone.mockReturnValue(bulk.promise);
    const completing = inbox.completeAll([{ itemId: "a", turnId: null }]);

    const snoozed = item("a", { updatedAt: 3, snoozedUntil: 99 });
    api.listInbox.mockResolvedValue({ items: [snoozed] });
    stream.handlers!.onReconnect!();
    await vi.waitFor(() => expect(inbox.snoozed).toEqual([snoozed]));
    bulk.resolve({ items: [item("a", { updatedAt: 2, state: "done" })] });

    expect(await completing).toBe(1);
    expect(inbox.snoozed).toEqual([snoozed]);
    expect(inbox.history).toEqual([]);
  });

  it("leaves items available on failure and retries the same captured targets", async () => {
    inbox.items = [item("a"), item("request", { kind: "request" }), item("snoozed", { snoozedUntil: 99 })];
    const targets = inbox.eligible.map(({ id, source }) => ({ itemId: id, turnId: source.turnId }));
    api.markAllDone.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(inbox.completeAll(targets)).rejects.toThrow("Unavailable");
    expect(inbox.completing).toBe(false);
    expect(inbox.open.map(({ id }) => id)).toEqual(["a", "request"]);

    inbox.items = [...inbox.items, item("arrival")];
    api.markAllDone.mockResolvedValue({ items: [item("a", { state: "done", updatedAt: 2 })] });
    expect(await inbox.completeAll(targets)).toBe(1);
    expect(api.markAllDone.mock.calls).toEqual([[{ targets }], [{ targets }]]);
    expect(inbox.open.map(({ id }) => id)).toEqual(["request", "arrival"]);
    expect(inbox.snoozed.map(({ id }) => id)).toEqual(["snoozed"]);
  });

  it("snoozes, dismisses and marks done, and says why when it can't", async () => {
    inbox.items = [item("a"), item("b"), item("c")];
    api.snoozeItem.mockResolvedValue({ item: item("a", { snoozedUntil: 50, updatedAt: 2 }) });
    api.dismissItem.mockResolvedValue({ item: item("b", { state: "dismissed", updatedAt: 2 }) });
    api.markItemDone.mockRejectedValue(new Error("Inbox item not found"));
    await inbox.snooze("a", 50);
    await inbox.dismiss("b");
    await inbox.done("c");
    expect(inbox.open.map((open) => open.id)).toEqual(["c"]);
    expect(inbox.error).toBe("Inbox item not found");
  });
});
