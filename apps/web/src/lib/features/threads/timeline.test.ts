import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { describe, expect, it } from "vitest";
import { applyEvent, emptyTimeline } from "./timeline.ts";

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
