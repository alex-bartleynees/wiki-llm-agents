import { describe, expect, it } from "vitest";
import { diffLines, numberedDiffLines } from "./diff-lines.ts";

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

describe("numberedDiffLines", () => {
  it("numbers each side from the hunk headers", () => {
    const diff = "@@ -3,3 +3,3 @@\n same\n-old\n+new\n+added\n\\ No newline at end of file\n@@ -0,0 +1 @@\n+first";
    expect(numberedDiffLines(diff).map(({ line, oldLine, newLine }) => [line, oldLine, newLine])).toEqual([
      ["@@ -3,3 +3,3 @@", null, null],
      [" same", 3, 3],
      ["-old", 4, null],
      ["+new", null, 4],
      ["+added", null, 5],
      ["@@ -0,0 +1 @@", null, null],
      ["+first", null, 1],
    ]);
  });
});
