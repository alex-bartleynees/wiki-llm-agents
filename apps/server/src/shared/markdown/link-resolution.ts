import { posix } from "node:path";

/** The parts of `[[target#heading|alias]]` (inner text, without the brackets). */
export interface ParsedWikilink {
  /** Empty for links within the same note (`[[#Heading]]`). */
  readonly target: string;
  readonly heading: string | undefined;
  /** `[[Note#^block-id]]` */
  readonly block: string | undefined;
  readonly alias: string | undefined;
}

export const parseWikilink = (inner: string): ParsedWikilink => {
  // Inside tables the pipe is escaped as `\|`.
  const unescaped = inner.replaceAll("\\|", "|");
  const pipe = unescaped.indexOf("|");
  const link = pipe === -1 ? unescaped : unescaped.slice(0, pipe);
  const alias = pipe === -1 ? undefined : unescaped.slice(pipe + 1).trim() || undefined;
  const hash = link.indexOf("#");
  const target = (hash === -1 ? link : link.slice(0, hash)).trim();
  // Nested headings (`Note#H1#H2`) point at the last one, as in Obsidian.
  const subpath = hash === -1 ? undefined : link.slice(hash + 1).split("#").at(-1)?.trim() || undefined;
  if (subpath?.startsWith("^")) {
    return { target, heading: undefined, block: subpath.slice(1) || undefined, alias };
  }
  return { target, heading: subpath, block: undefined, alias };
};

/** Lookup over every file in a vault, built once per render. */
export interface LinkIndex {
  readonly byPath: ReadonlyMap<string, string>;
  readonly paths: ReadonlyArray<string>;
  readonly bySuffix: ReadonlyMap<string, ReadonlyArray<string>>;
}

export const makeLinkIndex = (paths: ReadonlyArray<string>): LinkIndex => {
  const bySuffix = new Map<string, Array<string>>();
  for (const path of paths) {
    const segments = path.toLowerCase().split("/");
    for (let i = 1; i < segments.length; i++) {
      const suffix = segments.slice(i).join("/");
      const matches = bySuffix.get(suffix) ?? [];
      matches.push(path);
      bySuffix.set(suffix, matches);
    }
  }
  return {
    byPath: new Map(paths.map((path) => [path.toLowerCase(), path])),
    paths,
    bySuffix,
  };
};

const folderOf = (path: string) => {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
};

/** Fewer folders first, then shorter, then alphabetical: Obsidian's "shortest path". */
const byShortestPath = (a: string, b: string) =>
  a.split("/").length - b.split("/").length || a.length - b.length || a.localeCompare(b);

/**
 * Resolves a link target the way Obsidian does, case-insensitively:
 * 1. an exact vault path (`.md` implied when the target has none),
 * 2. a path relative to the linking note's folder (`../Other`),
 * 3. any file whose path ends with the target (`Note`, `Folder/Note`): one match wins;
 *    with several, one in the linking note's folder, else the shortest path.
 * Returns undefined when nothing matches.
 */
export const resolveLinkTarget = (
  index: LinkIndex,
  rawTarget: string,
  fromPath: string,
): string | undefined => {
  const target = rawTarget.trim().replace(/^\/+/, "");
  if (target === "") return undefined;
  // `Effect 4.1` has an "extension" too, so always try the markdown file first.
  const candidates = [`${target}.md`, target].map((candidate) => candidate.toLowerCase());
  const fromFolder = folderOf(fromPath).toLowerCase();

  for (const candidate of candidates) {
    const exact = index.byPath.get(candidate);
    if (exact !== undefined) return exact;
  }
  for (const candidate of candidates) {
    const relative = posix.normalize(posix.join(fromFolder, candidate));
    if (relative.startsWith("..")) continue;
    const match = index.byPath.get(relative);
    if (match !== undefined) return match;
  }
  for (const candidate of candidates) {
    const matches = index.bySuffix.get(candidate) ?? [];
    if (matches.length === 0) continue;
    const sameFolder = matches.find((path) => folderOf(path).toLowerCase() === fromFolder);
    return sameFolder ?? [...matches].sort(byShortestPath)[0];
  }
  return undefined;
};

/**
 * Every file a link target matches by path suffix, the step where a link can be
 * ambiguous (`[[Plan]]` with `A/Plan.md` and `B/Plan.md`). Shortest path first.
 */
export const suffixMatches = (index: LinkIndex, rawTarget: string): ReadonlyArray<string> => {
  const target = rawTarget.trim().replace(/^\/+/, "").toLowerCase();
  if (target === "") return [];
  for (const candidate of [`${target}.md`, target]) {
    const matches = index.bySuffix.get(candidate) ?? [];
    if (matches.length > 0) return [...matches].sort(byShortestPath);
  }
  return [];
};

/** Markdown URLs name a file relative to their source, without wikilink fallback. */
export const resolveMarkdownTarget = (index: LinkIndex, target: string, fromPath: string): string | undefined => {
  const path = posix.normalize(posix.join(posix.dirname(fromPath), target));
  if (path === ".." || path.startsWith("../")) return undefined;
  return index.byPath.get(path.toLowerCase());
};
