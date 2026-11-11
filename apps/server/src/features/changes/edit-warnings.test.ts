import { describe, expect, it } from "vitest";
import { editWarnings } from "./edit-warnings.js";

const note = (body: string, frontmatter = "") => (frontmatter === "" ? body : `---\n${frontmatter}\n---\n${body}`);
const long = "Green tea in the afternoon, oolong on cold days, and sencha with lunch.";

describe("editWarnings", () => {
  it.each([
    ["a small addition", note(`# Tea\n\n${long}\n`), note(`# Tea\n\n${long}\nMore.\n`), []],
    ["a body cut below 70%", note(`# Tea\n\n${long}\n`), note("# Tea\n\nGreen tea.\n"), [expect.stringMatching(/^The note got much shorter: \d+% of its length\.$/)]],
    ["a body cut to exactly 70% or more", note("# T\n\n" + "x".repeat(96) + "\n"), note("# T\n\n" + "x".repeat(66) + "\n"), []],
    ["a frontmatter title change", note("Body\n", "title: Tea"), note("Body\n", "title: Drinks"), ['The title changed from "Tea" to "Drinks".']],
    ["a first heading change", note(`# Tea\n\n${long}\n`), note(`# Drinks\n\n${long}\n`), ['The first heading changed from "Tea" to "Drinks".']],
    ["a removed first heading", note(`# Tea\n\n${long}\n`), note(`${long}\n`), ['The first heading "Tea" was removed.']],
    ["a heading inside code is not the first heading", note("```\n# not a heading\n```\n# Tea\n"), note("```\n# still not\n```\n# Tea\n"), []],
    ["dropped frontmatter keys", note(`${long}\n`, "status: draft\nsource: web"), note(`${long}\n`, "status: draft"), ["Frontmatter dropped: source."]],
    ["dropped tags", note(`${long}\n`, "tags: [tea, drinks]"), note(`${long}\n`, "tags: [Tea]"), ["Tags dropped: drinks."]],
    ["a created note", null, "# New\n", []],
    ["a deleted note", "# Old\n", null, []],
  ])("%s", (_name, before, after, expected) => {
    expect(editWarnings("Tea.md", before, after)).toEqual(expected);
  });

  it("only checks markdown notes", () => {
    expect(editWarnings("data.json", '{"a": 1, "b": 2, "c": 3}', "{}")).toEqual([]);
  });
});
