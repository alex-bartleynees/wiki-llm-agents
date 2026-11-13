export interface TextDiffLine {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
}

/**
 * The lines of `before` and `after`, each kept, removed or added, by the longest
 * common subsequence of lines. Config files are small (64 KiB at most), so the
 * quadratic table is fine.
 */
export const textDiff = (before: string, after: string): ReadonlyArray<TextDiffLine> => {
  const a = before.split("\n");
  const b = after.split("\n");
  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const lines: Array<TextDiffLine> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (i < a.length && (j === b.length || common[i + 1]![j]! >= common[i]![j + 1]!)) {
      // Removals first, so a changed line reads as the old one then the new.
      lines.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  return lines;
};
