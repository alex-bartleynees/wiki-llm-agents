/*
 * Fuzzy matching for the quick switcher: the query's characters must appear in the
 * text in order, ignoring case. Of all the ways they could line up, the best scoring
 * one wins, where runs of consecutive characters and characters at the start of a
 * word score highest (`eff serv` → **Eff**ect **Serv**er). As in fzf, every
 * character of a run earns the bonus of the word start it began at, so `rag` prefers
 * **RAG** Layer to **R**ecipes **a**nd **G**uided Brew. Pure, so it is tested on
 * its own; dynamic programming over query × text, which is fast for titles and paths.
 */

export interface FuzzyMatch {
  readonly score: number;
  /** Indices (UTF-16) of the matched characters in the text, ascending. */
  readonly positions: ReadonlyArray<number>;
}

const MATCH = 1;
const CONSECUTIVE = 4;
const WORD_START = 8;
const AFTER_SLASH = 9;
const CAMEL = 6;
/** Per character skipped between two matched characters. */
const GAP = 0.3;
/** Per character before the first match. */
const LEADING = 0.1;
/** Per character of text, so shorter texts win ties. */
const LENGTH = 0.01;

const SEPARATOR = /[\s\-_.()[\]{}]/;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

/** How good a place `index` is to match a character: the start of a word scores more than its middle. */
const boundaryBonus = (text: string, index: number): number => {
  if (index === 0) return WORD_START;
  const previous = text[index - 1]!;
  if (previous === "/") return AFTER_SLASH;
  if (SEPARATOR.test(previous)) return WORD_START;
  if (LOWER.test(previous) && UPPER.test(text[index]!)) return CAMEL;
  return 0;
};

/** The best way `query` (already lower case, no spaces) lines up in `text`, or undefined when it doesn't. */
export const fuzzyMatch = (query: string, text: string): FuzzyMatch | undefined => {
  const n = query.length;
  const m = text.length;
  if (n === 0 || n > m) return undefined;
  // Lower-casing can change a string's length (`İ` → `i̇`); then go character by
  // character and keep the first unit, so positions still index into `text`.
  const lower = text.toLowerCase();
  const charAt = lower.length === m ? (index: number) => lower[index]! : (index: number) => text[index]!.toLowerCase()[0]!;

  const bonus = Array.from({ length: m }, (_, index) => boundaryBonus(text, index));
  // score[i][j]: best score with query[i] matched at text[j]; from[i][j]: where query[i-1]
  // was matched; run[i][j]: the bonus the run ending at j carries.
  const score: Array<Float64Array> = [];
  const from: Array<Int32Array> = [];
  const run: Array<Float64Array> = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m).fill(-Infinity);
    const back = new Int32Array(m).fill(-1);
    const runRow = new Float64Array(m);
    const previous = score[i - 1];
    const previousRun = run[i - 1];
    // Best of previous[k] - GAP * (j - k - 1) over k < j - 1, carried along j.
    let gapBest = -Infinity;
    let gapFrom = -1;
    for (let j = i; j < m; j++) {
      if (previous !== undefined && j >= 2) {
        const candidate = previous[j - 2]!;
        gapBest -= GAP;
        if (candidate - GAP > gapBest) {
          gapBest = candidate - GAP;
          gapFrom = j - 2;
        }
      }
      if (charAt(j) !== query[i]) continue;
      if (previous === undefined || previousRun === undefined) {
        row[j] = MATCH + bonus[j]! - LEADING * j;
        runRow[j] = bonus[j]!;
        continue;
      }
      const carried = j >= 1 ? Math.max(bonus[j]!, previousRun[j - 1]!) : 0;
      const adjacent = j >= 1 ? previous[j - 1]! + CONSECUTIVE + MATCH + carried : -Infinity;
      const gapped = gapBest + MATCH + bonus[j]!;
      if (adjacent > -Infinity && adjacent >= gapped) {
        row[j] = adjacent;
        back[j] = j - 1;
        runRow[j] = carried;
      } else if (gapped > -Infinity) {
        row[j] = gapped;
        back[j] = gapFrom;
        runRow[j] = bonus[j]!;
      }
    }
    score.push(row);
    from.push(back);
    run.push(runRow);
  }

  const last = score[n - 1]!;
  let end = -1;
  for (let j = 0; j < m; j++) if (last[j]! > -Infinity && (end === -1 || last[j]! > last[end]!)) end = j;
  if (end === -1) return undefined;

  const positions = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = from[i]![j]!;
  }
  return { score: last[end]! - LENGTH * m, positions };
};

/** The query as matched: lower case, without whitespace. */
export const normaliseFuzzyQuery = (query: string) => query.toLowerCase().replace(/\s+/g, "");
