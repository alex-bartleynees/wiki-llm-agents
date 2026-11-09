import { describe, expect, it } from "vitest";
import { renderNote } from "../../features/notes/render/render-note.js";
import { extractNote } from "./extract.js";
import { makeLinkIndex } from "./link-resolution.js";

const NOTE = `---
title: Plan
tags: [project, "#plan"]
---
# Heading

See [[Other]], [[Other|again]], [[Folder/Deep#Part]], ![[diagram.png|300]] and [[#Heading]].

[md link](Other%20Note.md#x) ![img](assets/a.png) [web](https://example.com)

\`[[Not A Link]]\`

\`\`\`
[[Also Not]]
\`\`\`

> [!note] Callout with [[Inside Callout]]
`;

describe("extractNote", () => {
  const note = extractNote(NOTE, "projects/plan.md");

  it("reads title, tags, and frontmatter", () => {
    expect(note.title).toBe("Plan");
    expect(note.tags).toEqual(["project", "plan"]);
    expect(note.frontmatter).toEqual({ title: "Plan", tags: ["project", "#plan"] });
  });

  it("keeps the body without the frontmatter", () => {
    expect(note.body.startsWith("# Heading\n")).toBe(true);
    expect(note.body).not.toContain("title: Plan");
  });

  it("finds unique links outside code, but not same-note headings or web links", () => {
    expect(note.links).toEqual([
      { kind: "wikilink", target: "Other" },
      { kind: "wikilink", target: "Folder/Deep" },
      { kind: "embed", target: "diagram.png" },
      { kind: "markdown", target: "Other Note.md" },
      { kind: "markdown", target: "assets/a.png" },
      { kind: "wikilink", target: "Inside Callout" },
    ]);
  });

  it("finds the same links the renderer records", () => {
    const rendered = renderNote(NOTE, {
      path: "projects/plan.md",
      index: makeLinkIndex([]),
      viewHref: () => undefined,
      fileHref: (path) => path,
    });
    const key = (link: { kind: string; target: string }) => `${link.kind}:${link.target}`;
    expect(new Set(note.links.map(key))).toEqual(new Set(rendered.links.map(key)));
  });

  it("uses the file name when there is no title", () => {
    expect(extractNote("text", "a/My Note.md").title).toBe("My Note");
  });
});
