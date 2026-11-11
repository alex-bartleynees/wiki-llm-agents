import { describe, expect, it } from "vitest";
import { diffLines } from "./diff-lines.ts";

describe("diffLines", () => {
  it("marks hunks, insertions and deletions, and drops file headers", () => {
    const diff = "Index: a.md\n===================================================================\n--- a.md\n+++ a.md\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n\\ No newline at end of file";
    expect(diffLines(diff)).toEqual([
      { line: "@@ -1,2 +1,2 @@", kind: "hunk" },
      { line: " same", kind: "same" },
      { line: "-old", kind: "del" },
      { line: "+new", kind: "ins" },
    ]);
  });
});
