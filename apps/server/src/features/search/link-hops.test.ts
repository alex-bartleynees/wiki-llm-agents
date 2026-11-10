import { describe, expect, it } from "vitest";
import { rankNeighbours } from "./link-hops.js";

const edge = (from: string, to: string) => ({ from, to });

describe("rankNeighbours", () => {
  it("follows links both ways", () => {
    const ranked = rankNeighbours(["a.md"], [edge("a.md", "out.md"), edge("in.md", "a.md")], new Set());
    expect(ranked.map((note) => note.path)).toEqual(["in.md", "out.md"]);
  });

  it("ranks a note linked with better results first", () => {
    const ranked = rankNeighbours(["top.md", "second.md"], [edge("second.md", "x.md"), edge("top.md", "y.md")], new Set());
    expect(ranked.map((note) => note.path)).toEqual(["y.md", "x.md"]);
  });

  it("adds up links to several results, a link either way counting once", () => {
    const ranked = rankNeighbours(
      ["a.md", "b.md", "c.md"],
      [edge("a.md", "hub.md"), edge("hub.md", "a.md"), edge("b.md", "both.md"), edge("c.md", "both.md")],
      new Set(),
    );
    // both: 1/2 + 1/3 = 0.83; hub: 1 (once, though linked both ways).
    expect(ranked).toEqual([
      { path: "hub.md", via: ["a.md"], score: 1 },
      { path: "both.md", via: ["b.md", "c.md"], score: 1 / 2 + 1 / 3 },
    ]);
  });

  it("skips the frontier itself and excluded notes", () => {
    const ranked = rankNeighbours(["a.md", "b.md"], [edge("a.md", "b.md"), edge("a.md", "seen.md"), edge("a.md", "new.md")], new Set(["seen.md"]));
    expect(ranked.map((note) => note.path)).toEqual(["new.md"]);
  });

  it("breaks ties by path", () => {
    const ranked = rankNeighbours(["a.md"], [edge("a.md", "z.md"), edge("a.md", "m.md")], new Set());
    expect(ranked.map((note) => note.path)).toEqual(["m.md", "z.md"]);
  });
});
