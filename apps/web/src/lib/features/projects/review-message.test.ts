import { describe, expect, it } from "vitest";
import { numberedDiffLines } from "#lib/features/changes/diff-lines.ts";
import { displayPath, location, type ReviewComment, reviewMessage } from "./review-message.ts";

const lines = numberedDiffLines("@@ -10,3 +10,3 @@\n keep\n-const b = 2;\n+const b = 3;\n tail");
const [keep, removed, added, tail] = lines.slice(1);

const comment = (id: string, directory: string, path: string, quoted: ReviewComment["lines"], text: string): ReviewComment => ({ id, directory, path, lines: quoted, text });

describe("location", () => {
  it("names lines in the working tree, or the removed lines in HEAD", () => {
    expect(location("a.ts", [added!])).toBe("a.ts:11");
    expect(location("a.ts", [keep!, removed!, added!, tail!])).toBe("a.ts:10-12");
    expect(location("a.ts", [removed!])).toBe("a.ts (removed, HEAD line 11)");
  });
});

describe("displayPath", () => {
  it("is relative in the main directory and absolute in the others", () => {
    expect(displayPath(["/repo", "/other/"], "/repo", "src/a.ts")).toBe("src/a.ts");
    expect(displayPath(["/repo", "/other/"], "/other/", "b.ts")).toBe("/other/b.ts");
  });
});

describe("reviewMessage", () => {
  it("groups comments by file in directory order, then line order, quoting the lines", () => {
    const message = reviewMessage(
      ["/repo", "/docs"],
      [
        comment("1", "/docs", "guide.md", [added!], "Mention the new value."),
        comment("2", "/repo", "src/a.ts", [tail!], "  Rename this.  "),
        comment("3", "/repo", "src/a.ts", [removed!, added!], "Why 3?"),
      ],
    );
    expect(message).toBe(
      [
        "Review comments on the working tree (compared with HEAD), 3 comments. Please address them:",
        "## src/a.ts",
        "**src/a.ts:11**\n```diff\n-const b = 2;\n+const b = 3;\n```\nWhy 3?",
        "**src/a.ts:12**\n```diff\n tail\n```\nRename this.",
        "## /docs/guide.md",
        "**/docs/guide.md:11**\n```diff\n+const b = 3;\n```\nMention the new value.",
      ].join("\n\n"),
    );
  });

  it("fences quoted lines that contain backticks with a longer fence", () => {
    const fenced = numberedDiffLines("@@ -1 +1 @@\n+```ts");
    const message = reviewMessage(["/repo"], [comment("1", "/repo", "README.md", fenced.slice(1), "Close the fence.")]);
    expect(message).toContain("**README.md:1**\n````diff\n+```ts\n````\nClose the fence.");
    expect(message).toContain("1 comment.");
  });
});
