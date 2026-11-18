import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { describe, expect, it } from "vitest";
import { applyEvent, emptyTimeline, hasConversation, isCompacting } from "./timeline.ts";

const apply = (events: ReadonlyArray<ThreadEvent>) => {
  const timeline = emptyTimeline();
  events.forEach((event, index) => applyEvent(timeline, { threadId: "t", seq: index + 1, at: 0, event }));
  return timeline;
};

const change = (id: string, path: string) =>
  ({ id, path, change: "modify", attribution: "agent", diff: "", additions: 1, deletions: 0, truncated: false, warnings: [] }) as const;

describe("turn changes in the timeline", () => {
  it("shows a turn's changes before its end, and marks undone ones", () => {
    const timeline = apply([
      { _tag: "user.message", turnId: "a", text: "edit" },
      { _tag: "turn.started", turnId: "a" },
      { _tag: "turn.changes", turnId: "a", changes: [change("c1", "A.md"), change("c2", "B.md")] },
      { _tag: "turn.finished", turnId: "a", outcome: "completed", usage: null, reason: null },
      { _tag: "change.undone", turnId: "a", changeId: "c2" },
      { _tag: "change.undone", turnId: "missing", changeId: "c1" },
    ]);
    expect(timeline.items.map((item) => item.kind)).toEqual(["user", "changes", "turn-end"]);
    const card = timeline.items[1];
    expect(card?.kind === "changes" ? card.changes.map((item) => [item.path, item.undone]) : []).toEqual([
      ["A.md", false],
      ["B.md", true],
    ]);
  });
});

describe("the plan in the timeline", () => {
  it("shows one plan per turn, where it first appeared, with the latest steps", () => {
    const timeline = apply([
      { _tag: "user.message", turnId: "a", text: "plan" },
      { _tag: "turn.started", turnId: "a" },
      { _tag: "plan.updated", turnId: "a", steps: [{ text: "Read", status: "in_progress" }, { text: "Write", status: "pending" }] },
      { _tag: "message.delta", turnId: "a", messageId: "m", text: "Reading." },
      { _tag: "plan.updated", turnId: "a", steps: [{ text: "Read", status: "completed" }, { text: "Write", status: "in_progress" }] },
      { _tag: "turn.finished", turnId: "a", outcome: "completed", usage: null, reason: null },
      { _tag: "user.message", turnId: "b", text: "again" },
      { _tag: "plan.updated", turnId: "b", steps: [{ text: "Check", status: "pending" }] },
    ]);
    expect(timeline.items.map((item) => item.kind)).toEqual(["user", "plan", "agent", "turn-end", "user", "plan"]);
    const plan = timeline.items[1];
    expect(plan?.kind === "plan" ? plan.steps.map((step) => step.status) : []).toEqual(["completed", "in_progress"]);
  });
});

describe("a message's attachments in the timeline", () => {
  it("keeps the files sent with a message, and whether its images went as files", () => {
    const shot = { id: "i1", name: "shot.png", mime: "image/png", size: 1500, kind: "image" } as const;
    const csv = { id: "f1", name: "sales.csv", mime: "text/csv", size: 49, kind: "file" } as const;
    const timeline = apply([
      { _tag: "user.message", turnId: "a", text: "", attachments: [shot, csv], imagesAsFiles: true },
      { _tag: "user.message", turnId: "b", text: "plain" },
    ]);
    expect(timeline.items).toEqual([
      expect.objectContaining({ kind: "user", text: "", attachments: [shot, csv], imagesAsFiles: true }),
      expect.objectContaining({ kind: "user", text: "plain", attachments: [], imagesAsFiles: false }),
    ]);
  });
});

describe("a compaction you asked for in the timeline", () => {
  it("marks the request, knows the running turn is a compaction, and shows its outcome", () => {
    const timeline = apply([
      { _tag: "user.message", turnId: "a", text: "hello" },
      { _tag: "turn.started", turnId: "a" },
      { _tag: "turn.finished", turnId: "a", outcome: "completed", usage: null, reason: null },
      { _tag: "compaction.requested", turnId: "b" },
      { _tag: "turn.started", turnId: "b" },
    ]);
    expect(hasConversation(timeline)).toBe(true);
    expect(isCompacting(timeline)).toBe(true);
    expect(timeline.items.map((item) => item.kind)).toEqual(["user", "turn-end", "compaction-request"]);

    applyEvent(timeline, { threadId: "t", seq: 6, at: 0, event: { _tag: "context.compaction", turnId: "b", outcome: "completed", trigger: "manual", beforeTokens: 24_000, afterTokens: 6_000 } });
    applyEvent(timeline, { threadId: "t", seq: 7, at: 0, event: { _tag: "turn.finished", turnId: "b", outcome: "completed", usage: null, reason: null } });
    expect(isCompacting(timeline)).toBe(false);
    // Compact numbers follow the locale (24K, 24k...).
    expect(timeline.items.at(-2)).toMatchObject({ kind: "notice", text: expect.stringMatching(/^Requested compaction completed · 24k → 6k tokens$/i) });
  });

  it("says when the provider didn't report compacting anything, and why one failed", () => {
    const timeline = apply([
      { _tag: "compaction.requested", turnId: "b" },
      { _tag: "context.compaction", turnId: "b", outcome: "noop", trigger: "manual" },
      { _tag: "compaction.requested", turnId: "c" },
      { _tag: "context.compaction", turnId: "c", outcome: "failed", trigger: "manual", reason: "Not enough messages to compact." },
    ]);
    expect(timeline.items.filter((item) => item.kind === "notice").map((item) => (item.kind === "notice" ? item.text : ""))).toEqual([
      "Compaction finished, but the provider didn't report compacting anything",
      "Requested compaction failed · Not enough messages to compact.",
    ]);
    expect(hasConversation(timeline)).toBe(false);
  });
});
