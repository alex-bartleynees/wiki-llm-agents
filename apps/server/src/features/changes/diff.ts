import { applyPatch, structuredPatch } from "diff";

/** Lines and characters a diff kept in a thread's history may have. */
export const MAX_DIFF_LINES = 300;
export const MAX_DIFF_CHARS = 16_000;

export interface BoundedDiff {
  /** Hunks only (`@@ ... @@` headers and lines), without file headers. */
  readonly diff: string;
  readonly additions: number;
  readonly deletions: number;
  /** The diff was cut to the limits. */
  readonly truncated: boolean;
}

/**
 * A unified diff with three lines of context, so unchanged parts are left out, cut
 * to `MAX_DIFF_LINES` and `MAX_DIFF_CHARS`. Counts cover the whole diff.
 * `null` content is a file that doesn't exist (created or deleted).
 */
export const boundedDiff = (before: string | null, after: string | null): BoundedDiff => {
  const patch = structuredPatch("a", "b", before ?? "", after ?? "", "", "", { context: 3 });
  const lines: Array<string> = [];
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    // As in unified diff output, an empty side starts at line 0.
    const start = (line: number, count: number) => (count === 0 ? line - 1 : line);
    lines.push(`@@ -${start(hunk.oldStart, hunk.oldLines)},${hunk.oldLines} +${start(hunk.newStart, hunk.newLines)},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
      lines.push(line);
    }
  }
  let kept = lines.slice(0, MAX_DIFF_LINES).join("\n");
  let truncated = lines.length > MAX_DIFF_LINES;
  if (kept.length > MAX_DIFF_CHARS) {
    kept = kept.slice(0, MAX_DIFF_CHARS);
    kept = kept.slice(0, Math.max(0, kept.lastIndexOf("\n")));
    truncated = true;
  }
  return { diff: kept, additions, deletions, truncated };
};

/** The content after applying a unified diff to `before`; undefined when it doesn't apply. */
export const applyUnifiedPatch = (before: string, patch: string): string | undefined => {
  try {
    const result = applyPatch(before, patch);
    return result === false ? undefined : result;
  } catch {
    return undefined;
  }
};
