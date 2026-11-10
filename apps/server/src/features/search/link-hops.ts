import type { NoteEdge } from "../indexing/vault-index.js";

export interface LinkedNote {
  readonly path: string;
  /** Notes of the previous hop it links to or is linked from, best ranked first. */
  readonly via: ReadonlyArray<string>;
  readonly score: number;
}

/**
 * The notes one link away from `frontier` (best first), skipping `exclude`.
 * A neighbour scores the sum of `1 / (rank + 1)` over the frontier notes it is linked
 * with, a link either way counting once, so one linked to the top results ranks
 * first; ties go by path. A simple stand-in for the related-notes ranking (slice 7b).
 */
export const rankNeighbours = (
  frontier: ReadonlyArray<string>,
  edges: ReadonlyArray<NoteEdge>,
  exclude: ReadonlySet<string>,
): ReadonlyArray<LinkedNote> => {
  const rank = new Map(frontier.map((path, index) => [path, index]));
  const via = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    if (!rank.has(from) || exclude.has(to) || rank.has(to)) return;
    const sources = via.get(to) ?? new Set<string>();
    sources.add(from);
    via.set(to, sources);
  };
  for (const edge of edges) {
    connect(edge.from, edge.to);
    connect(edge.to, edge.from);
  }
  return [...via]
    .map(([path, sources]) => {
      const ordered = [...sources].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
      return { path, via: ordered, score: ordered.reduce((sum, source) => sum + 1 / ((rank.get(source) ?? 0) + 1), 0) };
    })
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};
