export type DiffLineKind = "hunk" | "ins" | "del" | "same";

export interface DiffLine {
  readonly line: string;
  readonly kind: DiffLineKind;
}

/** A unified diff's lines, marked for colour; file header lines (`Index:`, `---`, `+++`) are left out. */
export const diffLines = (diff: string): ReadonlyArray<DiffLine> =>
  diff
    .split("\n")
    .filter((line) => !/^(Index: |={10,}$|--- |\+\+\+ |\\ No newline)/.test(line))
    .map((line) => ({
      line,
      kind: line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "ins" : line.startsWith("-") ? "del" : "same",
    }));

/** A diff line with its line numbers: `oldLine` in the file before, `newLine` after (null on the side it isn't on). */
export interface NumberedDiffLine extends DiffLine {
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A unified diff's lines numbered from its hunk headers; hunk headers have no numbers. */
export const numberedDiffLines = (diff: string): ReadonlyArray<NumberedDiffLine> => {
  let oldLine = 0;
  let newLine = 0;
  return diffLines(diff).map(({ line, kind }) => {
    if (kind === "hunk") {
      const match = HUNK.exec(line);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      return { line, kind, oldLine: null, newLine: null };
    }
    if (kind === "del") return { line, kind, oldLine: oldLine++, newLine: null };
    if (kind === "ins") return { line, kind, oldLine: null, newLine: newLine++ };
    return { line, kind, oldLine: oldLine++, newLine: newLine++ };
  });
};
