import { describe, expect, it } from "vitest";
import { boundHunks, isInsidePath, parseNameStatus, sectionToFile, splitPatch, untrackedFile, withoutDiff } from "./git-diff.js";

const encode = (text: string) => new TextEncoder().encode(text);
const limits = { lines: 100, chars: 10_000 };

describe("parseNameStatus", () => {
  it("reads each status, with two paths for renames and copies", () => {
    expect(parseNameStatus("M\0a.ts\0A\0b.ts\0D\0c.ts\0R087\0old.ts\0new.ts\0C100\0src.ts\0copy.ts\0T\0link\0U\0conflict.ts\0")).toEqual([
      { status: "modified", path: "a.ts", oldPath: null },
      { status: "added", path: "b.ts", oldPath: null },
      { status: "deleted", path: "c.ts", oldPath: null },
      { status: "renamed", path: "new.ts", oldPath: "old.ts" },
      { status: "added", path: "copy.ts", oldPath: null },
      { status: "modified", path: "link", oldPath: null },
      { status: "modified", path: "conflict.ts", oldPath: null },
    ]);
  });

  it("keeps names with spaces, tabs and newlines as they are", () => {
    expect(parseNameStatus("M\0a b\tc\nd.ts\0")).toEqual([{ status: "modified", path: "a b\tc\nd.ts", oldPath: null }]);
    expect(parseNameStatus("")).toEqual([]);
  });
});

describe("splitPatch and sectionToFile", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "index 1..2 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-diff --git a/x b/x",
    "+--- not a header",
    "diff --git a/img.png b/img.png",
    "index 1..2 100644",
    "Binary files a/img.png and b/img.png differ",
    "diff --git a/run.sh b/run.sh",
    "old mode 100644",
    "new mode 100755",
    "",
  ].join("\n");

  it("splits per file, without mistaking content for a header", () => {
    expect(splitPatch(patch).map((section) => section.length)).toEqual([8, 3, 3]);
  });

  it("keeps hunks only, counts lines, and marks binary files", () => {
    const [text, binary, mode] = splitPatch(patch);
    expect(sectionToFile({ status: "modified", path: "a.ts", oldPath: null }, text!, limits)).toEqual({
      status: "modified", path: "a.ts", oldPath: null, binary: false, additions: 1, deletions: 1, truncated: false,
      diff: "@@ -1,2 +1,2 @@\n keep\n-diff --git a/x b/x\n+--- not a header",
    });
    expect(sectionToFile({ status: "modified", path: "img.png", oldPath: null }, binary!, limits)).toMatchObject({ binary: true, diff: "", additions: 0 });
    expect(sectionToFile({ status: "modified", path: "run.sh", oldPath: null }, mode!, limits)).toMatchObject({ binary: false, diff: "", truncated: false });
  });
});

describe("boundHunks", () => {
  const lines = ["@@ -1,3 +1,3 @@", "-a", "+b", "+c", " d"];

  it("cuts to the line limit and counts every line", () => {
    expect(boundHunks(lines, { lines: 2, chars: 1000 })).toEqual({ diff: "@@ -1,3 +1,3 @@\n-a", additions: 2, deletions: 1, truncated: true });
  });

  it("cuts to the character limit at a line boundary", () => {
    expect(boundHunks(lines, { lines: 100, chars: 17 })).toEqual({ diff: "@@ -1,3 +1,3 @@", additions: 2, deletions: 1, truncated: true });
  });

  it("keeps a diff within both limits whole", () => {
    expect(boundHunks(lines, limits).truncated).toBe(false);
  });
});

describe("untrackedFile", () => {
  it("shows a new file as all added, as git would", () => {
    expect(untrackedFile("n.ts", encode("one\ntwo\n"), limits)).toEqual({
      path: "n.ts", oldPath: null, status: "untracked", binary: false, additions: 2, deletions: 0, truncated: false, diff: "@@ -0,0 +1,2 @@\n+one\n+two",
    });
    expect(untrackedFile("n.ts", encode("one"), limits).diff).toBe("@@ -0,0 +1 @@\n+one\n\\ No newline at end of file");
  });

  it("gives empty and binary files no diff", () => {
    expect(untrackedFile("e.ts", encode(""), limits)).toMatchObject({ binary: false, diff: "", additions: 0 });
    expect(untrackedFile("b.bin", new Uint8Array([1, 0, 2]), limits)).toMatchObject({ binary: true, diff: "", additions: 0 });
  });
});

describe("withoutDiff", () => {
  it("drops the diff and marks it cut, leaving files without one alone", () => {
    const file = untrackedFile("n.ts", encode("x\n"), limits);
    expect(withoutDiff(file)).toEqual({ ...file, diff: "", truncated: true });
    const empty = untrackedFile("e.ts", encode(""), limits);
    expect(withoutDiff(empty)).toBe(empty);
  });
});

describe("isInsidePath", () => {
  it("accepts relative paths that stay inside", () => {
    for (const path of ["a.ts", "src/a.ts", "..a/b", "a..b"]) expect(isInsidePath(path)).toBe(true);
  });

  it("refuses absolute, empty, dot and parent segments", () => {
    for (const path of ["", "/etc/passwd", "../a", "a/../../b", "./a", "a//b", "a/", "a\0b"]) expect(isInsidePath(path)).toBe(false);
  });
});
