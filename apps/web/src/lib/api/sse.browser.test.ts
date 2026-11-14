import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tab's one event stream with a stand-in EventSource and API client, so a test
 * decides when the server says `connected`, sends messages, or drops the stream.
 */

const client = vi.hoisted(() => ({ postJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock("./client.ts", () => client);

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static readonly opened: Array<FakeEventSource> = [];
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.opened.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  send(frame: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  connected(connectionId: string) {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
    this.send({ type: "connected", connectionId });
  }
  drop(readyState: number) {
    this.readyState = readyState;
    this.dispatchEvent(new Event("error"));
  }
}
vi.stubGlobal("EventSource", FakeEventSource);

const { listen } = await import("./sse.ts");

const Message = Schema.Struct({ type: Schema.Literals(["ready", "changed"]), n: Schema.optionalKey(Schema.Number) });
const latest = () => FakeEventSource.opened.at(-1)!;
/** The subscribe calls: connection path, subscription id and topic. */
const subscribes = () =>
  client.postJson.mock.calls.map(([path, , body]) => ({ path, ...(body as { subscriptionId: string; topic: unknown }) }));
/** Lets the subscribe POSTs' answers reach the hub. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let stops: Array<() => void> = [];
const follow = (...args: Parameters<typeof listen<typeof Message>>) => {
  const stop = listen(...args);
  stops.push(stop);
  return stop;
};

beforeEach(() => {
  client.postJson.mockReset().mockImplementation((_path: string, _request: unknown, body: { subscriptionId: string }) =>
    Promise.resolve({ subscriptionId: body.subscriptionId }),
  );
  client.deleteJson.mockReset().mockResolvedValue({});
  FakeEventSource.opened.length = 0;
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  vi.useRealTimers();
});

describe("the tab's event stream", () => {
  it("carries every listener's topic on one connection and routes messages by subscription", async () => {
    const inbox = vi.fn();
    const vault = vi.fn();
    follow({ type: "inbox" }, Message, { onEvent: inbox });
    follow({ type: "vault", vaultId: "v1" }, Message, { onEvent: vault });
    expect(FakeEventSource.opened).toHaveLength(1);
    expect(latest().url).toBe("/events");
    expect(client.postJson).not.toHaveBeenCalled();

    latest().connected("c1");
    const [first, second] = subscribes();
    expect(first).toMatchObject({ path: "/api/events/c1/subscriptions", topic: { type: "inbox" } });
    expect(second).toMatchObject({ path: "/api/events/c1/subscriptions", topic: { type: "vault", vaultId: "v1" } });

    latest().send({ type: "message", subscriptionId: second!.subscriptionId, message: { type: "changed", n: 1 } });
    latest().send({ type: "message", subscriptionId: first!.subscriptionId, message: { type: "ready" } });
    // Doesn't match the listener's schema: ignored.
    latest().send({ type: "message", subscriptionId: first!.subscriptionId, message: { type: "weather" } });
    expect(vault.mock.calls).toEqual([[{ type: "changed", n: 1 }]]);
    expect(inbox.mock.calls).toEqual([[{ type: "ready" }]]);
  });

  it("subscribes a later listener at once, unsubscribes one that stops, and closes with the last", () => {
    follow({ type: "inbox" }, Message, { onEvent: vi.fn() });
    latest().connected("c1");
    const stop = follow({ type: "all-threads" }, Message, { onEvent: vi.fn() });
    expect(FakeEventSource.opened).toHaveLength(1);
    const later = subscribes()[1]!;
    expect(later.topic).toEqual({ type: "all-threads" });

    stop();
    expect(client.deleteJson).toHaveBeenCalledWith(`/api/events/c1/subscriptions/${later.subscriptionId}`, expect.anything());
    expect(latest().closed).toBe(false);
    for (const each of stops) each();
    expect(latest().closed).toBe(true);
  });

  it("subscribes everything again on a new connection, resuming from the topic's latest state", async () => {
    let after = 0;
    const onReconnect = vi.fn();
    follow(() => ({ type: "thread", threadId: "t1", after }), Message, { onEvent: vi.fn(), onReconnect });
    latest().connected("c1");
    await settle();
    expect(onReconnect).not.toHaveBeenCalled();

    after = 7;
    // The browser reconnects by itself; messages for the old connection stop counting.
    latest().drop(FakeEventSource.CONNECTING);
    latest().connected("c2");
    expect(subscribes().at(-1)).toMatchObject({ path: "/api/events/c2/subscriptions", topic: { type: "thread", threadId: "t1", after: 7 } });
    expect(onReconnect).not.toHaveBeenCalled();
    await settle();
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("opens a new stream after a backoff when the browser gives up on one", () => {
    vi.useFakeTimers();
    follow({ type: "inbox" }, Message, { onEvent: vi.fn() });
    latest().connected("c1");
    latest().drop(FakeEventSource.CLOSED);
    expect(FakeEventSource.opened).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.opened).toHaveLength(2);
    latest().connected("c2");
    expect(subscribes().at(-1)).toMatchObject({ path: "/api/events/c2/subscriptions", topic: { type: "inbox" } });
  });
});
