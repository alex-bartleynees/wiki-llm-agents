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
