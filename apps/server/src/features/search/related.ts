import { Effect } from "effect";
import { folderOf } from "../../shared/paths.js";
import { buildNoteGraph, type NoteEdge, type NoteSummary, VaultIndex, type VaultNoteGraph } from "../indexing/vault-index.js";

export const RELATED_WEIGHTS = { direct: 10, common: 2, tag: 1, folder: 0.25 } as const;

export const rankRelatedFromGraph = (path: string, graph: VaultNoteGraph) => {
  const source = graph.byPath.get(path);
  const neighbours = graph.adjacency.get(path);
  const sourceTags = source !== undefined && source.tags.length > 0 ? new Set(source.tags) : undefined;
  const sourceFolder = folderOf(path);

  const candidates = new Set<string>();
  const commonScores = new Map<string, number>();
  if (neighbours !== undefined) {
    for (const neighbour of neighbours) {
      if (neighbour !== path) candidates.add(neighbour);
      const secondHop = graph.adjacency.get(neighbour);
      if (secondHop === undefined) continue;
      const weight = 1 / Math.log(Math.max(2, secondHop.size));
      for (const other of secondHop) {
        if (other === path) continue;
        candidates.add(other);
        commonScores.set(other, (commonScores.get(other) ?? 0) + weight);
      }
    }
  }
  if (sourceTags !== undefined) {
    for (const tag of sourceTags) {
      const tagged = graph.byTag.get(tag);
      if (tagged !== undefined) for (const other of tagged) if (other !== path) candidates.add(other);
    }
  }
  const sameFolder = graph.byFolder.get(sourceFolder);
  if (sameFolder !== undefined) {
    for (const other of sameFolder) if (other !== path) candidates.add(other);
  }

  const ranked: Array<NoteSummary & { readonly score: number; readonly reasons: Array<string> }> = [];
  for (const candidatePath of candidates) {
    const note = graph.byPath.get(candidatePath);
    if (note === undefined) continue;
    const reasons: Array<string> = [];
    let score = 0;
    if (neighbours?.has(candidatePath)) {
      score += RELATED_WEIGHTS.direct;
      reasons.push("Direct link");
    }
    const common = commonScores.get(candidatePath) ?? 0;
    if (common > 0) {
      score += RELATED_WEIGHTS.common * common;
      reasons.push("Shared neighbours");
    }
    if (sourceTags !== undefined && note.tags.length > 0) {
      let sharedTags = 0;
      for (const tag of note.tags) if (sourceTags.has(tag)) sharedTags += 1;
      if (sharedTags > 0) {
        score += sharedTags * RELATED_WEIGHTS.tag;
        reasons.push("Shared tags");
      }
    }
    if (folderOf(candidatePath) === sourceFolder) {
      score += RELATED_WEIGHTS.folder;
      reasons.push("Same folder");
    }
    if (score > 0) ranked.push({ ...note, score, reasons });
  }
  return ranked.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};

/** Undirected, deduplicated graph; rare common neighbours carry more evidence. */
export const rankRelated = (path: string, notes: ReadonlyArray<NoteSummary>, edges: ReadonlyArray<NoteEdge>) =>
  rankRelatedFromGraph(path, buildNoteGraph(notes, edges));

export const relatedGraph = Effect.fnUntraced(function* (vaultId: string) {
  return yield* (yield* VaultIndex).noteGraph(vaultId);
});

export const relatedNotes = Effect.fnUntraced(function* (vaultId: string, path: string) {
  const graph = yield* relatedGraph(vaultId);
  return rankRelatedFromGraph(path, graph);
});
