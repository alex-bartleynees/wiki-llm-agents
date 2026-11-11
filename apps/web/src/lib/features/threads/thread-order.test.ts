import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { describe, expect, it } from "vitest";
import { byRecent, doneThreads, openThreads } from "./thread-order.ts";

const thread = (id: string, updatedAt: number, doneAt: number | null) => ({ id, updatedAt, createdAt: 0, doneAt }) as ThreadSummary;

describe("thread order", () => {
  const threads = [thread("a", 1, null), thread("b", 5, 10), thread("c", 3, null), thread("d", 9, 20)];

  it("keeps open threads in the given order", () => {
    expect(openThreads(threads).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("lists done threads most recently marked first", () => {
    expect(doneThreads(threads).map((t) => t.id)).toEqual(["d", "b"]);
  });

  it("sorts by most recently updated", () => {
    expect([...threads].sort(byRecent).map((t) => t.id)).toEqual(["d", "b", "c", "a"]);
  });
});
