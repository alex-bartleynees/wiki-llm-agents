import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NumberedDiffLine } from "#lib/features/changes/diff-lines.ts";

/** The review drafts with real Svelte state and localStorage; only the threads API is a stand-in. */

const api = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("#lib/features/threads/api.ts", () => api);

const { review } = await import("./review.svelte.ts");

const line: NumberedDiffLine = { line: "+const b = 3;", kind: "ins", oldLine: null, newLine: 4 };
const draft = (text: string) => ({ directory: "/repo", path: "a.ts", lines: [line], text });

beforeEach(() => {
  localStorage.clear();
  review.clear("p1");
  review.clear("p2");
  api.sendMessage.mockReset();
});

describe("review drafts", () => {
  it("are kept per project on this device", () => {
    review.add("p1", draft("first"));
    review.add("p2", draft("other"));
    expect(review.comments("p1").map((comment) => comment.text)).toEqual(["first"]);
    expect(JSON.parse(localStorage.getItem("wiki-agents:review:p1")!)).toHaveLength(1);
    review.remove("p1", review.comments("p1")[0]!.id);
    expect(review.comments("p1")).toEqual([]);
    expect(localStorage.getItem("wiki-agents:review:p1")).toBeNull();
    expect(review.comments("p2")).toHaveLength(1);
  });

  it("go to the thread as one message and are cleared once sent", async () => {
    review.add("p1", draft("Why 3?"));
    api.sendMessage.mockResolvedValue({ turnId: "t" });
    await review.send("p1", ["/repo"], "thread-1");
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(api.sendMessage.mock.calls[0]![0]).toBe("thread-1");
    expect(api.sendMessage.mock.calls[0]![1]).toContain("**a.ts:4**\n```diff\n+const b = 3;\n```\nWhy 3?");
    expect(review.comments("p1")).toEqual([]);
  });

  it("stay when sending fails, and a comment added meanwhile is kept after a send", async () => {
    review.add("p1", draft("kept"));
    api.sendMessage.mockRejectedValueOnce(new Error("A turn is already running"));
    await expect(review.send("p1", ["/repo"], "thread-1")).rejects.toThrow("A turn is already running");
    expect(review.comments("p1")).toHaveLength(1);

    let finish: (value: unknown) => void = () => {};
    api.sendMessage.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const sending = review.send("p1", ["/repo"], "thread-1");
    review.add("p1", draft("later"));
    finish({ turnId: "t" });
    await sending;
    expect(review.comments("p1").map((comment) => comment.text)).toEqual(["later"]);
  });
});
