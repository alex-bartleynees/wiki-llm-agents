export interface FuzzyMatch {
  readonly score: number;
  readonly positions: ReadonlyArray<number>;
}

export interface QuickSwitchCandidate<Kind extends string> {
  readonly path: string;
  readonly kind: Kind;
  readonly title?: string | undefined;
}

export interface QuickSwitchMatch<Kind extends string> {
  readonly path: string;
  readonly kind: Kind;
  readonly title: string;
  readonly match: { readonly field: "title" | "path"; readonly positions: ReadonlyArray<number> };
}

const MATCH = 1;
const CONSECUTIVE = 4;
const WORD_START = 8;
const AFTER_SLASH = 9;
const CAMEL = 6;
const GAP = 0.3;
const LEADING = 0.1;
const LENGTH = 0.01;
const TITLE_BONUS = 4;
const DEFAULT_LIMIT = 20;

const SEPARATOR = /[\s\-_.()[\]{}]/;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const pathCollator = new Intl.Collator("en");

const isAsciiSeparator = (code: number) =>
  code === 32 ||
  code === 9 ||
  code === 10 ||
  code === 13 ||
  code === 45 ||
  code === 95 ||
  code === 46 ||
  code === 40 ||
  code === 41 ||
  code === 91 ||
  code === 93 ||
  code === 123 ||
  code === 125;

const isLower = (text: string, index: number, code: number) => (code < 128 ? code >= 97 && code <= 122 : LOWER.test(text[index]!));
const isUpper = (text: string, index: number, code: number) => (code < 128 ? code >= 65 && code <= 90 : UPPER.test(text[index]!));

const boundaryBonus = (text: string, index: number): number => {
  if (index === 0) return WORD_START;
  const prevCode = text.charCodeAt(index - 1);
  if (prevCode === 47) return AFTER_SLASH;
  if (prevCode < 128 ? isAsciiSeparator(prevCode) : SEPARATOR.test(text[index - 1]!)) return WORD_START;
  const currCode = text.charCodeAt(index);
  if (isLower(text, index - 1, prevCode) && isUpper(text, index, currCode)) return CAMEL;
  return 0;
};

let scratchBonus = new Uint8Array(256);
let scratchPrevScore = new Float64Array(256);
let scratchCurrScore = new Float64Array(256);
let scratchPrevRun = new Float64Array(256);
let scratchCurrRun = new Float64Array(256);
let scratchFrom = new Int32Array(2048);

const ensureRowBuffers = (m: number, nm: number) => {
  if (m > scratchBonus.length) {
    const next = Math.max(m, scratchBonus.length * 2);
    scratchBonus = new Uint8Array(next);
    scratchPrevScore = new Float64Array(next);
    scratchCurrScore = new Float64Array(next);
    scratchPrevRun = new Float64Array(next);
    scratchCurrRun = new Float64Array(next);
  }
  if (nm > scratchFrom.length) {
    scratchFrom = new Int32Array(Math.max(nm, scratchFrom.length * 2));
  }
};

export const fuzzyMatch = (query: string, text: string): FuzzyMatch | undefined => {
  const n = query.length;
  const m = text.length;
  if (n === 0 || n > m) return undefined;
  const lower = text.toLowerCase();
  const sameLength = lower.length === m;
  if (sameLength) {
    let pos = -1;
    for (let i = 0; i < n; i++) {
      pos = lower.indexOf(query[i]!, pos + 1);
      if (pos === -1) return undefined;
    }
  } else {
    let qi = 0;
    for (let j = 0; j < m && qi < n; j++) {
      if (text[j]!.toLowerCase()[0] === query[qi]) qi++;
    }
    if (qi < n) return undefined;
  }

  ensureRowBuffers(m, n * m);
  const bonus = scratchBonus;
  for (let j = 0; j < m; j++) bonus[j] = boundaryBonus(text, j);
  let previous = scratchPrevScore;
  let current = scratchCurrScore;
  let previousRun = scratchPrevRun;
  let currentRun = scratchCurrRun;
  const from = scratchFrom;

  for (let i = 0; i < n; i++) {
    const qChar = query[i]!;
    const rowOffset = i * m;
    current.fill(-Infinity, 0, m);
    currentRun.fill(0, 0, m);
    from.fill(-1, rowOffset, rowOffset + m);
    let gapBest = -Infinity;
    let gapFrom = -1;
    const isFirst = i === 0;
    for (let j = i; j < m; j++) {
      if (!isFirst && j >= 2) {
        const candidate = previous[j - 2]!;
        gapBest -= GAP;
        if (candidate - GAP > gapBest) {
          gapBest = candidate - GAP;
          gapFrom = j - 2;
        }
      }
      const ch = sameLength ? lower[j]! : text[j]!.toLowerCase()[0]!;
      if (ch !== qChar) continue;
      const b = bonus[j]!;
      if (isFirst) {
        current[j] = MATCH + b - LEADING * j;
        currentRun[j] = b;
        continue;
      }
      const carried = j >= 1 ? Math.max(b, previousRun[j - 1]!) : 0;
      const adjacent = j >= 1 ? previous[j - 1]! + CONSECUTIVE + MATCH + carried : -Infinity;
      const gapped = gapBest + MATCH + b;
      if (adjacent > -Infinity && adjacent >= gapped) {
        current[j] = adjacent;
        from[rowOffset + j] = j - 1;
        currentRun[j] = carried;
      } else if (gapped > -Infinity) {
        current[j] = gapped;
        from[rowOffset + j] = gapFrom;
        currentRun[j] = b;
      }
    }
    const tmpScore = previous;
    previous = current;
    current = tmpScore;
    const tmpRun = previousRun;
    previousRun = currentRun;
    currentRun = tmpRun;
  }

  let end = -1;
  for (let j = 0; j < m; j++) if (previous[j]! > -Infinity && (end === -1 || previous[j]! > previous[end]!)) end = j;
  if (end === -1) return undefined;

  const positions = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = from[i * m + j]!;
  }
  return { score: previous[end]! - LENGTH * m, positions };
};

export const normaliseFuzzyQuery = (query: string) => query.toLowerCase().replace(/\s+/g, "");

const defaultTitle = (path: string, kind: string) => {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  return kind === "note" ? name.replace(/\.md$/i, "") : name;
};

export const rankQuickSwitch = <Kind extends string>(
  files: ReadonlyArray<QuickSwitchCandidate<Kind>>,
  rawQuery: string,
  limit = DEFAULT_LIMIT,
): Array<QuickSwitchMatch<Kind>> => {
  const query = normaliseFuzzyQuery(rawQuery);
  if (query === "") return [];
  const scored: Array<{ readonly score: number; readonly result: QuickSwitchMatch<Kind> }> = [];
  for (const file of files) {
    if (file.kind === "file") continue;
    const title = file.title ?? defaultTitle(file.path, file.kind);
    const byTitle = fuzzyMatch(query, title);
    const byPath = fuzzyMatch(query, file.path);
    const best =
      byTitle !== undefined && (byPath === undefined || byTitle.score + TITLE_BONUS >= byPath.score)
        ? { score: byTitle.score + TITLE_BONUS, field: "title" as const, positions: byTitle.positions }
        : byPath !== undefined
          ? { score: byPath.score, field: "path" as const, positions: byPath.positions }
          : undefined;
    if (best === undefined) continue;
    scored.push({
      score: best.score,
      result: { path: file.path, kind: file.kind, title, match: { field: best.field, positions: best.positions } },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.result.path.length - b.result.path.length || pathCollator.compare(a.result.path, b.result.path));
  return scored.slice(0, limit).map((entry) => entry.result);
};
