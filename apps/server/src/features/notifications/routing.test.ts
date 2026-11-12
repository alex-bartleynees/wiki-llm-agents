import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { DEFAULT_NOTIFICATION_PREFERENCES as DEFAULTS } from "@wiki-agents/contracts/notifications/model";
import { describe, expect, it } from "vitest";
import { decide, digestItem, payloadFor, plainText } from "./routing.js";

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: "item-1",
  kind: "reminder",
  title: "Water the plants",
  body: "The **ferns** too",
  state: "open",
  read: false,
  overdue: false,
  snoozedUntil: null,
  resolution: null,
  source: { vaultId: null, threadId: null, turnId: null, requestId: null, scheduleId: null, notePath: null },
  deliveries: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("decide", () => {
  it("sends reminders and requests at once, as urgent", () => {
    expect(decide(item(), DEFAULTS)).toEqual({ _tag: "send", urgent: true });
    expect(decide(item({ kind: "request" }), DEFAULTS)).toEqual({ _tag: "send", urgent: true });
    expect(decide(item({ kind: "prompt.result" }), DEFAULTS)).toEqual({ _tag: "send", urgent: false });
  });

  it("follows each group's route", () => {
    const routes = { ...DEFAULTS.routes, results: "digest" as const };
    expect(decide(item({ kind: "prompt.result" }), { ...DEFAULTS, routes })).toEqual({ _tag: "hold" });
    expect(decide(item({ kind: "prompt.failed" }), { ...DEFAULTS, routes })).toEqual({ _tag: "hold" });
    expect(decide(item({ kind: "turn.finished" }), DEFAULTS)).toMatchObject({ _tag: "skip", reason: "Notifications are off for turns." });
  });

  it("skips everything when muted, and items handled before they were sent", () => {
    expect(decide(item(), { ...DEFAULTS, muted: true })).toMatchObject({ _tag: "skip", reason: "Notifications are muted." });
    expect(decide(item({ kind: "digest" }), { ...DEFAULTS, muted: true })._tag).toBe("skip");
    expect(decide(item({ kind: "request", state: "done" }), DEFAULTS)._tag).toBe("skip");
  });

  it("always sends the digest", () => {
    const allDigest = { ...DEFAULTS, routes: { reminders: "digest", requests: "digest", results: "digest", turns: "digest" } as const };
    expect(decide(item({ kind: "digest" }), allDigest)).toEqual({ _tag: "send", urgent: false });
  });
});

describe("payloadFor", () => {
  it("says the item's title and text, and opens the item", () => {
    expect(payloadFor(item(), DEFAULTS)).toEqual({ title: "Water the plants", body: "The ferns too", url: "/inbox?item=item-1", tag: "item-1" });
  });

  it("says only the kind of item when previews are private", () => {
    const payload = payloadFor(item({ kind: "request", title: "Approve: rm -rf secrets" }), { privatePreviews: true });
    expect(payload).toEqual({ title: "wiki-agents", body: "An agent is waiting for you.", url: "/inbox?item=item-1", tag: "item-1" });
  });

  it("clips long answers", () => {
    const payload = payloadFor(item({ kind: "prompt.result", body: "word ".repeat(500) }), DEFAULTS);
    expect(payload.body.length).toBeLessThanOrEqual(400);
    expect(payload.body.endsWith("…")).toBe(true);
  });
});

describe("plainText", () => {
  it("drops markdown syntax", () => {
    expect(plainText("# News\n\n- **One** [link](https://x.y)\n- [[Notes/Two|Two]]\n\n```js\ncode\n```\n> quote")).toBe("News One link Two quote");
  });
});

describe("digestItem", () => {
  it("lists the held items", () => {
    expect(digestItem([{ kind: "prompt.result", title: "Morning news" }, { kind: "reminder", title: "Stretch" }])).toEqual({
      kind: "digest",
      title: "Digest: 2 items",
      body: "• Morning news\n• Stretch",
      source: {},
    });
  });
});
