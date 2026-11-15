import type { DiffFile } from "@wiki-agents/contracts/projects/model";
import { describe, expect, it } from "vitest";
import { cleanMessage, commitPrompt } from "./commit-prompt.js";

const file = (path: string, diff: string, extra: Partial<DiffFile> = {}): DiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  additions: 1,
  deletions: 1,
  diff,
  truncated: false,
  ...extra,
});

describe("commit prompt", () => {
  it("lists the files, the recent subjects and each diff", () => {
    const { prompt, truncated } = commitPrompt(
      [file("app.ts", "@@ -1 +1 @@\n-a\n+b"), file("new.ts", "", { oldPath: "old.ts", status: "renamed" }), file("logo.png", "", { binary: true })],
      ["Add themes", "Fix composer"],
    );
    expect(truncated).toBe(false);
    expect(prompt).toContain("Files to commit (3):\n- modified app.ts\n- renamed old.ts → new.ts\n- modified logo.png\n");
    expect(prompt).toContain("newest first:\n* Add themes\n* Fix composer\n");
    expect(prompt).toContain("### app.ts\n@@ -1 +1 @@\n-a\n+b");
    expect(prompt).toContain("### logo.png\n(binary file)");
    expect(prompt.endsWith("Write the commit message.")).toBe(true);
  });

  it("names files past the budget without their diff, and says when diffs were cut", () => {
    const { prompt, truncated } = commitPrompt([file("a.ts", "x".repeat(30)), file("b.ts", "y".repeat(30), { additions: 4, deletions: 2 })], [], 40);
    expect(truncated).toBe(true);
    expect(prompt).toContain("x".repeat(30));
    expect(prompt).not.toContain("y".repeat(30));
    expect(prompt).toContain("### b.ts\n(diff left out to keep this short: +4 −2)");
    expect(prompt).toContain("This repository has no commits yet.");
    expect(commitPrompt([file("c.ts", "z", { truncated: true })], []).truncated).toBe(true);
  });

  it("cleans the answer: fences, quotes, trailing spaces and extra blank lines", () => {
    expect(cleanMessage("```\nAdd tick boxes\n\nBody  \n```")).toBe("Add tick boxes\n\nBody");
    expect(cleanMessage('"Fix the push"')).toBe("Fix the push");
    expect(cleanMessage("Add a\n\n\n\nbody\n")).toBe("Add a\n\nbody");
    expect(cleanMessage('Quote "this" here')).toBe('Quote "this" here');
  });
});
