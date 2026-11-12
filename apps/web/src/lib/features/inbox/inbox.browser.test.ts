import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The inbox store with real Svelte state; the API and the event stream are stand-ins. */

const api = vi.hoisted(() => ({
  INBOX_EVENTS_PATH: "/events/inbox",
  listInbox: vi.fn(),
  markRead: vi.fn(),
  snoozeItem: vi.fn(),
  dismissItem: vi.fn(),
  markItemDone: vi.fn(),
}));
vi.mock("./api.ts", () => api);

const stream = vi.hoisted(() => ({ handlers: undefined as { onEvent: (event: unknown) => void; onReconnect?: () => void } | undefined }));
vi.mock("#lib/api/sse.ts", () => ({
  listen: (_path: string, _schema: unknown, handlers: typeof stream.handlers) => {
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
  for (const mock of [api.listInbox, api.markRead, api.snoozeItem, api.dismissItem, api.markItemDone]) mock.mockReset();
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
    api.markRead.mockResolvedValue({ items: [item("a", { read: true })] });
    await inbox.read(["a", "b"]);
    expect(api.markRead).toHaveBeenCalledWith(["a"]);
    expect(inbox.unread).toBe(0);

    api.listInbox.mockResolvedValue({ items: [item("a", { read: true }), item("z")] });
    stream.handlers!.onReconnect!();
    await vi.waitFor(() => expect(inbox.unread).toBe(1));
  });

  it("snoozes, dismisses and marks done, and says why when it can't", async () => {
    inbox.items = [item("a"), item("b"), item("c")];
    api.snoozeItem.mockResolvedValue({ item: item("a", { snoozedUntil: 50 }) });
    api.dismissItem.mockResolvedValue({ item: item("b", { state: "dismissed" }) });
    api.markItemDone.mockRejectedValue(new Error("Inbox item not found"));
    await inbox.snooze("a", 50);
    await inbox.dismiss("b");
    await inbox.done("c");
    expect(inbox.open.map((open) => open.id)).toEqual(["c"]);
    expect(inbox.error).toBe("Inbox item not found");
  });
});
