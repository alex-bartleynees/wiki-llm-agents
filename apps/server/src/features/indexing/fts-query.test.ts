import { describe, expect, it } from "vitest";
import { ftsMatch, leadParts, MATCH_END, MATCH_START, snippetParts } from "./fts-query.js";

describe("ftsMatch", () => {
  it.each([
    ["effe", '"effe"*'],
    ["effect server", '"effect"* "server"*'],
    ['"exact phrase" more', '"exact phrase" "more"*'],
    ['"unclosed phrase', '"unclosed phrase"'],
    ["foo-bar", '"foo-bar"*'],
    ['say"hi', '"sayhi"*'],
    ["NOT AND OR NEAR(a b)", '"NOT"* "AND"* "OR"* "NEAR(a"* "b)"*'],
    ["title:x", '"title:x"*'],
    ["café", '"café"*'],
  ])("quotes %j as %j", (input, expected) => {
    expect(ftsMatch(input)).toBe(expected);
  });

  it.each(["", "   ", "- * :", '""', '" "', "#"])("has nothing to search for in %j", (input) => {
    expect(ftsMatch(input)).toBeUndefined();
  });
});

describe("snippetParts", () => {
  const marked = (text: string) => `${MATCH_START}${text}${MATCH_END}`;

  it("splits marked matches from the text around them", () => {
    expect(snippetParts(`…the ${marked("Effect")} server and ${marked("effects")}…`)).toEqual([
      { text: "…the ", match: false },
      { text: "Effect", match: true },
      { text: " server and ", match: false },
      { text: "effects", match: true },
      { text: "…", match: false },
    ]);
  });

  it("collapses newlines and merges adjacent matches", () => {
    expect(snippetParts(`one\n\n${marked("two")}${marked("three")}\nfour`)).toEqual([
      { text: "one ", match: false },
      { text: "twothree", match: true },
      { text: " four", match: false },
    ]);
  });

  it("drops markdown emphasis, code, and wikilink markers, which are noise in a one-line passage", () => {
    expect(snippetParts(`**${marked("apps/server")}**: see [[${marked("Plan")}|the plan]] and \`code\` __x__`)).toEqual([
      { text: "apps/server", match: true },
      { text: ": see ", match: false },
      { text: "Plan", match: true },
      { text: "|the plan and code x", match: false },
    ]);
  });

  it("handles an unclosed marker and empty input", () => {
    expect(snippetParts(`a ${MATCH_START}b`)).toEqual([
      { text: "a ", match: false },
      { text: "b", match: true },
    ]);
    expect(snippetParts("")).toEqual([]);
  });
});

describe("leadParts", () => {
  it("skips frontmatter and shortens long bodies", () => {
    expect(leadParts("---\ntags: [a]\n---\n# Title\n\nBody text")).toEqual([{ text: "# Title Body text", match: false }]);
    expect(leadParts(`${"word ".repeat(100)}`, 20)).toEqual([{ text: "word word word word…", match: false }]);
    expect(leadParts("---\ntags: [a]\n---\n")).toEqual([]);
  });
});
