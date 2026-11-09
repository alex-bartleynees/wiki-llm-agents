import { describe, expect, it } from "vitest";
import { makeLinkIndex, parseWikilink, resolveLinkTarget } from "./link-resolution.js";

describe("parseWikilink", () => {
  it.each([
    ["Note", { target: "Note", heading: undefined, block: undefined, alias: undefined }],
    ["Note|Shown", { target: "Note", heading: undefined, block: undefined, alias: "Shown" }],
    ["Note#Heading", { target: "Note", heading: "Heading", block: undefined, alias: undefined }],
    ["Note#Heading|Shown", { target: "Note", heading: "Heading", block: undefined, alias: "Shown" }],
    ["Note#H1#H2", { target: "Note", heading: "H2", block: undefined, alias: undefined }],
    ["Note#^abc123", { target: "Note", heading: undefined, block: "abc123", alias: undefined }],
    ["#Heading", { target: "", heading: "Heading", block: undefined, alias: undefined }],
    ["Note\\|Shown", { target: "Note", heading: undefined, block: undefined, alias: "Shown" }],
    ["image.png|300", { target: "image.png", heading: undefined, block: undefined, alias: "300" }],
  ])("%s", (inner, expected) => {
    expect(parseWikilink(inner)).toEqual(expected);
  });
});

describe("resolveLinkTarget", () => {
  const index = makeLinkIndex([
    "index.md",
    "Effect 4.1.md",
    "1-Active/Project/README.md",
    "1-Active/Project/Plan.md",
    "2-Areas/Plan.md",
    "3-Resources/Deep/Nested/Plan.md",
    "3-Resources/Unique Note.md",
    "Inbox/README.md",
    "assets/Pasted image 1.png",
  ]);

  it.each([
    { case: "exact path with .md implied", target: "1-Active/Project/Plan", from: "index.md", expected: "1-Active/Project/Plan.md" },
    { case: "exact path with .md", target: "2-Areas/Plan.md", from: "index.md", expected: "2-Areas/Plan.md" },
    { case: "leading slash", target: "/2-Areas/Plan", from: "index.md", expected: "2-Areas/Plan.md" },
    { case: "shortest unique name", target: "Unique Note", from: "index.md", expected: "3-Resources/Unique Note.md" },
    { case: "case-insensitive", target: "unique note", from: "index.md", expected: "3-Resources/Unique Note.md" },
    { case: "name with a dot", target: "Effect 4.1", from: "2-Areas/Plan.md", expected: "Effect 4.1.md" },
    { case: "ambiguous: same folder wins", target: "Plan", from: "1-Active/Project/README.md", expected: "1-Active/Project/Plan.md" },
    { case: "ambiguous: else shortest path", target: "Plan", from: "index.md", expected: "2-Areas/Plan.md" },
    { case: "ambiguous README from its own folder", target: "README", from: "Inbox/x.md", expected: "Inbox/README.md" },
    { case: "partial path", target: "Nested/Plan", from: "index.md", expected: "3-Resources/Deep/Nested/Plan.md" },
    { case: "relative path", target: "../Plan", from: "3-Resources/Deep/Nested/Other/x.md", expected: "3-Resources/Deep/Nested/Plan.md" },
    { case: "non-markdown file", target: "Pasted image 1.png", from: "index.md", expected: "assets/Pasted image 1.png" },
    { case: "unresolved", target: "Missing Note", from: "index.md", expected: undefined },
    { case: "partial name is not a match", target: "nique Note", from: "index.md", expected: undefined },
    { case: "relative escape is ignored", target: "../../etc/passwd", from: "index.md", expected: undefined },
    { case: "empty", target: "", from: "index.md", expected: undefined },
  ])("$case", ({ target, from, expected }) => {
    expect(resolveLinkTarget(index, target, from)).toBe(expected);
  });
});
