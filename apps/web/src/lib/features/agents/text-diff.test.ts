import { describe, expect, it } from "vitest";
import { textDiff } from "./text-diff.ts";

describe("textDiff", () => {
  it("keeps common lines and marks the rest removed (before) or added (after)", () => {
    expect(textDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("is all same for equal text, and all added from nothing", () => {
    expect(textDiff("x\ny", "x\ny").every((line) => line.kind === "same")).toBe(true);
    expect(textDiff("", "x")).toEqual([
      { kind: "removed", text: "" },
      { kind: "added", text: "x" },
    ]);
  });
});
