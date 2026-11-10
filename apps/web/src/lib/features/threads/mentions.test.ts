import { describe, expect, it } from "vitest";
import { mentionAt, noteName, withoutMention } from "./mentions.ts";

describe("@ mentions in a message", () => {
  it("finds the name being typed after @, with spaces, at the caret", () => {
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("see @coffee pl", 14)).toEqual({ start: 4, query: "coffee pl" });
    expect(mentionAt("(@tea", 5)).toEqual({ start: 1, query: "tea" });
    expect(mentionAt("see @coffee and more", 11)).toEqual({ start: 4, query: "coffee" });
  });

  it("ignores emails, a space straight after @, other lines and long runs", () => {
    expect(mentionAt("me@example.com", 14)).toBeNull();
    expect(mentionAt("@ coffee", 8)).toBeNull();
    expect(mentionAt("@coffee\nnext", 12)).toBeNull();
    expect(mentionAt(`@${"x".repeat(61)}`, 62)).toBeNull();
    expect(mentionAt("no mention", 10)).toBeNull();
  });

  it("removes the mention without leaving a double space", () => {
    expect(withoutMention("see @cof and", 4, 8)).toEqual({ text: "see and", caret: 3 });
    expect(withoutMention("see @cof", 4, 8)).toEqual({ text: "see", caret: 3 });
    expect(withoutMention("@cof", 0, 4)).toEqual({ text: "", caret: 0 });
    expect(withoutMention("x\n@cof", 2, 6)).toEqual({ text: "x\n", caret: 2 });
  });

  it("names a note by its title, else its file name", () => {
    expect(noteName("Notes/Coffee Plan.md")).toBe("Coffee Plan");
    expect(noteName("Notes/Coffee Plan.md", "Plans for coffee")).toBe("Plans for coffee");
  });
});
