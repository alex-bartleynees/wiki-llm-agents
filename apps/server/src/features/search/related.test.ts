import { describe, expect, it } from "vitest";
import { buildNoteGraph } from "../indexing/vault-index.js";
import { rankRelated, rankRelatedFromGraph } from "./related.js";
describe("related notes", () => {
  const notes = ["source", "direct", "tag", "rare", "hub", "r", "h", "extra", "z", "a"].map((path) => ({ path: `${path}/note.md`, title: path, tags: ["source", "tag"].includes(path) ? ["shared"] : [] }));
  const edges = [["source", "direct"], ["source", "r"], ["rare", "r"], ["source", "h"], ["hub", "h"], ["extra", "h"], ["z", "h"], ["a", "h"]].map(([from, to]) => ({ from: `${from}/note.md`, to: `${to}/note.md` }));
  it("ranks direct links above tags and rare shared neighbours above hubs", () => {
    const graph = buildNoteGraph(notes, edges);
    const ranked = rankRelatedFromGraph("source/note.md", graph).map((note) => note.path);
    expect(ranked.indexOf("direct/note.md")).toBeLessThan(ranked.indexOf("tag/note.md"));
    expect(ranked.indexOf("rare/note.md")).toBeLessThan(ranked.indexOf("hub/note.md"));
    expect(ranked.indexOf("a/note.md")).toBeLessThan(ranked.indexOf("z/note.md"));
    expect(ranked).not.toContain("source/note.md");
    expect(rankRelatedFromGraph("source/note.md", graph)).toEqual(rankRelated("source/note.md", notes, edges));
  });
  it("deduplicates links in either direction", () => {
    const withDuplicates = buildNoteGraph(notes, [...edges, ...edges, { from: "direct/note.md", to: "source/note.md" }]);
    expect(rankRelatedFromGraph("source/note.md", withDuplicates)).toEqual(rankRelatedFromGraph("source/note.md", buildNoteGraph(notes, edges)));
  });
  it("scores same-folder notes and returns empty for isolated unknown paths", () => {
    const folderNotes = [
      { path: "area/a.md", title: "A", tags: [] },
      { path: "area/b.md", title: "B", tags: [] },
      { path: "other/c.md", title: "C", tags: [] },
    ];
    const graph = buildNoteGraph(folderNotes, []);
    expect(rankRelatedFromGraph("area/a.md", graph)).toEqual([
      { path: "area/b.md", title: "B", tags: [], score: 0.25, reasons: ["Same folder"] },
    ]);
    expect(rankRelatedFromGraph("missing/x.md", graph)).toEqual([]);
  });
});
