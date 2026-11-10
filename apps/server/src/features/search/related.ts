import type { NoteEdge, NoteSummary } from "../indexing/vault-index.js";
import { Effect } from "effect";
import { VaultIndex } from "../indexing/vault-index.js";

export const RELATED_WEIGHTS = { direct: 10, common: 2, tag: 1, folder: 0.25 } as const;

/** Undirected, deduplicated graph; rare common neighbours carry more evidence. */
export const rankRelated = (path: string, notes: ReadonlyArray<NoteSummary>, edges: ReadonlyArray<NoteEdge>) => {
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    if (from === to) continue;
    for (const [a, b] of [[from, to], [to, from]] as const) {
      const neighbours = graph.get(a) ?? new Set<string>();
      neighbours.add(b); graph.set(a, neighbours);
    }
  }
  const source = notes.find((note) => note.path === path);
  const neighbours = graph.get(path) ?? new Set<string>();
  const folder = (p: string) => p.split("/").slice(0, -1).join("/");
  return notes.filter((note) => note.path !== path).map((note) => {
    const reasons: string[] = [];
    let score = 0;
    if (neighbours.has(note.path)) { score += RELATED_WEIGHTS.direct; reasons.push("Direct link"); }
    let common = 0;
    for (const neighbour of graph.get(note.path) ?? []) {
      if (neighbours.has(neighbour)) common += 1 / Math.log(Math.max(2, graph.get(neighbour)?.size ?? 0));
    }
    if (common > 0) { score += RELATED_WEIGHTS.common * common; reasons.push("Shared neighbours"); }
    const tags = note.tags.filter((tag) => source?.tags.includes(tag));
    score += tags.length * RELATED_WEIGHTS.tag;
    if (tags.length) reasons.push("Shared tags");
    if (folder(path) === folder(note.path)) { score += RELATED_WEIGHTS.folder; reasons.push("Same folder"); }
    return { ...note, score, reasons };
  }).filter((note) => note.score > 0).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};

export const relatedGraph = Effect.fnUntraced(function* (vaultId: string) {
  const index = yield* VaultIndex;
  const paths = (yield* index.titledFiles(vaultId)).filter((file) => file.kind === "note").map((file) => file.path);
  return { notes: yield* index.notes(vaultId, paths), edges: yield* index.neighbours(vaultId, paths) };
});

export const relatedNotes = Effect.fnUntraced(function* (vaultId: string, path: string) {
  const graph = yield* relatedGraph(vaultId);
  return rankRelated(path, graph.notes, graph.edges);
});
