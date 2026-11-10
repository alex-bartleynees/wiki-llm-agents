import { describe, expect, it } from "vitest";
import { rankRelated } from "./related.js";
describe("related notes", () => {
  const notes = ["source", "direct", "tag", "rare", "hub", "r", "h", "extra", "z", "a"].map((path) => ({ path: `${path}/note.md`, title: path, tags: ["source", "tag"].includes(path) ? ["shared"] : [] }));
  const edges = [["source", "direct"], ["source", "r"], ["rare", "r"], ["source", "h"], ["hub", "h"], ["extra", "h"], ["z", "h"], ["a", "h"]].map(([from, to]) => ({ from: `${from}/note.md`, to: `${to}/note.md` }));
  it("ranks direct links above tags and rare shared neighbours above hubs", () => {
    const ranked = rankRelated("source/note.md", notes, edges).map((note) => note.path);
    expect(ranked.indexOf("direct/note.md")).toBeLessThan(ranked.indexOf("tag/note.md"));
    expect(ranked.indexOf("rare/note.md")).toBeLessThan(ranked.indexOf("hub/note.md"));
    expect(ranked.indexOf("a/note.md")).toBeLessThan(ranked.indexOf("z/note.md"));
    expect(ranked).not.toContain("source/note.md");
  });
  it("deduplicates links in either direction", () => {
    expect(rankRelated("source/note.md", notes, [...edges, ...edges, { from: "direct/note.md", to: "source/note.md" }])).toEqual(rankRelated("source/note.md", notes, edges));
  });
});
