import { describe, expect, it } from "vitest";
import { applyUnifiedPatch, boundedDiff, MAX_DIFF_LINES } from "./diff.js";

describe("boundedDiff", () => {
  it("keeps three lines of context around a change and counts lines", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
    const after = before.replace("line 10\n", "line ten\n");
    expect(boundedDiff(before, after)).toEqual({
      diff: "@@ -7,7 +7,7 @@\n line 7\n line 8\n line 9\n-line 10\n+line ten\n line 11\n line 12\n line 13",
      additions: 1,
      deletions: 1,
      truncated: false,
    });
  });

  it("diffs created and deleted files against nothing", () => {
    expect(boundedDiff(null, "# New\n")).toMatchObject({ diff: "@@ -0,0 +1,1 @@\n+# New", additions: 1, deletions: 0 });
    expect(boundedDiff("# Old\n", null)).toMatchObject({ diff: "@@ -1,1 +0,0 @@\n-# Old", additions: 0, deletions: 1 });
  });

  it("cuts a long diff to the line limit but counts all of it", () => {
    const after = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");
    const diff = boundedDiff("", after);
    expect(diff.truncated).toBe(true);
    expect(diff.additions).toBe(1000);
    expect(diff.diff.split("\n")).toHaveLength(MAX_DIFF_LINES);
  });

  it("cuts very long lines to the character limit at a line break", () => {
    const after = Array.from({ length: 50 }, () => "x".repeat(1000)).join("\n");
    const diff = boundedDiff("", after);
    expect(diff.truncated).toBe(true);
    expect(diff.diff.length).toBeLessThanOrEqual(16_000);
    expect(diff.diff.endsWith("x")).toBe(true);
  });
});

describe("applyUnifiedPatch", () => {
  it("applies a provider's patch, and refuses one that doesn't match", () => {
    const patch = "Index: Tea.md\n===\n--- Tea.md\n+++ Tea.md\n@@ -1,3 +1,4 @@\n # Tea\n \n Green tea.\n+Oolong too.\n";
    expect(applyUnifiedPatch("# Tea\n\nGreen tea.\n", patch)).toBe("# Tea\n\nGreen tea.\nOolong too.\n");
    expect(applyUnifiedPatch("# Coffee\n\nFlat white.\n", patch)).toBeUndefined();
  });
});
