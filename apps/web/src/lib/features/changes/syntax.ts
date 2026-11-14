import { type Language, LanguageDescription } from "@codemirror/language";
import { type ChangedRange, type Tree, TreeFragment } from "@lezer/common";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import type { DiffLine } from "./diff-lines.ts";

/** The colour names a token can have; each is a `::highlight(syntax-<name>)` rule in `tokens.css`. */
export const SYNTAX_STYLES = ["keyword", "string", "comment", "literal", "function", "type", "property", "meta", "heading", "link"] as const;
export type SyntaxStyle = (typeof SYNTAX_STYLES)[number];

/** A coloured span of one diff line's code, in characters after its `+`/`-`/space sign. */
export interface SyntaxToken {
  readonly from: number;
  readonly to: number;
  readonly style: SyntaxStyle;
}

/** Tokens for each diff line, in the same order; hunk headers have none. */
export type DiffSyntax = ReadonlyArray<ReadonlyArray<SyntaxToken>>;

/** Lezer's tags folded into a few colours; the most specific match wins (a string isn't a literal). */
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: "keyword" },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], class: "string" },
  { tag: tags.comment, class: "comment" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], class: "literal" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], class: "function" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: "type" },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], class: "property" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], class: "meta" },
  { tag: tags.heading, class: "heading" },
  { tag: [tags.link, tags.url], class: "link" },
]);

/**
 * Community Lezer grammars for languages `@codemirror/language-data` lacks (Nix,
 * Svelte) or only tokenises by keyword (C#: no user types or method names). Listed
 * first, so they win over its entries.
 */
const extraLanguages = [
  LanguageDescription.of({ name: "C#", extensions: ["cs", "csx"], load: () => import("@replit/codemirror-lang-csharp").then((m) => m.csharp()) }),
  LanguageDescription.of({ name: "Nix", extensions: ["nix"], load: () => import("@replit/codemirror-lang-nix").then((m) => m.nix()) }),
  LanguageDescription.of({ name: "Svelte", extensions: ["svelte"], load: () => import("@replit/codemirror-lang-svelte").then((m) => m.svelte()) }),
];

/**
 * Extensions coloured as another language. The .NET project files are XML; Razor is
 * close enough to HTML (its `@code` blocks stay plain).
 */
const ALIASES: Readonly<Record<string, string>> = {
  csproj: "XML",
  fsproj: "XML",
  vbproj: "XML",
  props: "XML",
  targets: "XML",
  slnx: "XML",
  xaml: "XML",
  axaml: "XML",
  resx: "XML",
  nuspec: "XML",
  razor: "HTML",
  cshtml: "HTML",
};

/**
 * Text to parse a hunk after, for grammars that only accept statements inside a class
 * and a method. A hunk usually starts mid-method; parsed bare, `var s` reads as a type.
 * Each hunk is parsed with each prefix, and the parse with the fewest errors wins.
 */
const CLASS_BODY = ["", "class _ {\n", "class _ { void _() {\n"];
const PREFIXES: Readonly<Record<string, ReadonlyArray<string>>> = { "C#": CLASS_BODY, Java: CLASS_BODY };

/** A language to colour a diff with, and the prefixes to try its hunks after. */
export interface Grammar {
  readonly language: Language;
  readonly prefixes: ReadonlyArray<string>;
}

let descriptions: Promise<ReadonlyArray<LanguageDescription>> | undefined;

/**
 * The grammar for a file, by its name, or null for none. The language list and each
 * language are loaded on first use, each in its own chunk, so they cost nothing until
 * a diff needs them.
 */
export const grammarFor = async (path: string): Promise<Grammar | null> => {
  descriptions ??= import("@codemirror/language-data").then((data) => [...extraLanguages, ...data.languages]);
  const all = await descriptions;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const alias = ALIASES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];
  const description = alias === undefined ? LanguageDescription.matchFilename(all, name) : LanguageDescription.matchLanguageName(all, alias, false);
  if (description === null) return null;
  return description.load().then(
    (support) => ({ language: support.language, prefixes: PREFIXES[description.name] ?? [""] }),
    () => null,
  );
};

/** Parse errors that start inside `from`–`to` (an unfinished class at the end doesn't count). */
const errorsIn = (tree: Tree, from: number, to: number) => {
  let errors = 0;
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.type.isError && node.from >= from && node.from < to) errors++;
    },
  });
  return errors;
};

/** Lines of a hunk to try the prefixes on: enough to tell statements from members, cheap to parse three times. */
const SAMPLE_LINES = 40;

/** The grammar's prefix that gives the fewest errors on the start of `text`. */
const bestPrefix = ({ language, prefixes }: Grammar, text: string) => {
  if (prefixes.length === 1) return prefixes[0]!;
  let end = 0;
  for (let line = 0; line < SAMPLE_LINES && end !== -1; line++) end = text.indexOf("\n", end + 1);
  const sample = end === -1 ? text : text.slice(0, end);
  let best = { prefix: prefixes[0]!, errors: Number.POSITIVE_INFINITY };
  for (const prefix of prefixes) {
    const errors = errorsIn(language.parser.parse(prefix + sample), prefix.length, prefix.length + sample.length);
    if (errors < best.errors) best = { prefix, errors };
    if (errors === 0) break;
  }
  return best.prefix;
};

/** Gives the main thread back, so input and rendering go on during a long parse. */
export type Pause = () => Promise<void>;

/** How long to parse before pausing. */
const SLICE_MS = 8;

/**
 * Parses `text`, pausing every few milliseconds when given `pause`. `fragments` are
 * pieces of an earlier parse of similar text, which Lezer reuses where they still fit.
 */
const parse = async (language: Language, text: string, pause: Pause | undefined, fragments?: ReadonlyArray<TreeFragment>): Promise<Tree> => {
  const partial = language.parser.startParse(text, fragments);
  let deadline = performance.now() + SLICE_MS;
  for (;;) {
    const tree = partial.advance();
    if (tree !== null) return tree;
    if (pause !== undefined && performance.now() > deadline) {
      await pause();
      deadline = performance.now() + SLICE_MS;
    }
  }
};

/** One side of a hunk: its lines' indexes in the diff, its text, and where each line starts in it. */
const side = (lines: ReadonlyArray<DiffLine>, indexes: ReadonlyArray<number>) => {
  const code = indexes.map((index) => lines[index]!.line.slice(1));
  const starts: Array<number> = [];
  let at = 0;
  for (const line of code) {
    starts.push(at);
    at += line.length + 1;
  }
  return { indexes, text: code.join("\n"), starts };
};

/**
 * Where the after side differs from the before side, in both texts' positions
 * (`offset` is the prefix both are parsed after): one range per run of removed and
 * added lines. Everything outside these ranges is the same text on both sides.
 */
const changedRanges = (lines: ReadonlyArray<DiffLine>, hunk: ReadonlyArray<number>, offset: number, lengthA: number, lengthB: number) => {
  const ranges: Array<ChangedRange> = [];
  let a = offset;
  let b = offset;
  let run: { readonly a: number; readonly b: number } | null = null;
  const close = () => {
    if (run !== null) ranges.push({ fromA: run.a, toA: Math.min(a, offset + lengthA), fromB: run.b, toB: Math.min(b, offset + lengthB) });
    run = null;
  };
  for (const index of hunk) {
    const { line, kind } = lines[index]!;
    // The line's code and its newline.
    const length = line.length;
    if (kind === "same") {
      close();
      a += length;
      b += length;
    } else {
      run ??= { a, b };
      if (kind === "del") a += length;
      else b += length;
    }
  }
  close();
  return ranges;
};

/** Adds each token of `tree` to the line it falls on, splitting tokens that span lines. */
const collect = (
  tree: Tree,
  offset: number,
  { indexes, text, starts }: ReturnType<typeof side>,
  into: Array<Array<SyntaxToken>>,
  keep: (index: number) => boolean,
) => {
  let line = 0;
  highlightTree(tree, highlighter, (treeFrom, treeTo, style) => {
    const from = treeFrom - offset;
    const to = treeTo - offset;
    if (to <= 0) return;
    // Tokens come in document order, so the current line only moves forward.
    while (line < starts.length - 1 && starts[line + 1]! <= from) line++;
    for (let current = line; current < starts.length && starts[current]! < to; current++) {
      const start = starts[current]!;
      const end = current + 1 < starts.length ? starts[current + 1]! - 1 : text.length;
      const tokenFrom = Math.max(from, start) - start;
      const tokenTo = Math.min(to, end) - start;
      const index = indexes[current]!;
      if (tokenTo > tokenFrom && keep(index)) into[index]!.push({ from: tokenFrom, to: tokenTo, style: style as SyntaxStyle });
    }
  });
};

/**
 * Colours a unified diff's lines. Each hunk is parsed twice, as the text before
 * (unchanged and removed lines) and after (unchanged and added lines), so code reads
 * as it does in the file; unchanged lines take their colours from the after side.
 * Colours at a hunk's edges are a guess: a hunk can start inside a comment. The after
 * side reuses the before side's tree wherever the text is unchanged, so a hunk costs
 * little more than one parse. With `pause`, parsing gives the main thread back every
 * few milliseconds.
 */
export const highlightDiff = async (lines: ReadonlyArray<DiffLine>, grammar: Grammar, pause?: Pause): Promise<DiffSyntax> => {
  const tokens: Array<Array<SyntaxToken>> = lines.map(() => []);
  let start = 0;
  while (start < lines.length) {
    if (lines[start]!.kind === "hunk") {
      start++;
      continue;
    }
    let end = start;
    while (end < lines.length && lines[end]!.kind !== "hunk") end++;
    const hunk = Array.from({ length: end - start }, (_, offset) => start + offset);
    const before = side(lines, hunk.filter((index) => lines[index]!.kind !== "ins"));
    const after = side(lines, hunk.filter((index) => lines[index]!.kind !== "del"));
    // Both sides after the same prefix, so the before tree's positions line up with the after text.
    const prefix = bestPrefix(grammar, after.indexes.length > 0 ? after.text : before.text);
    const offset = prefix.length;
    let beforeTree: Tree | null = null;
    if (before.indexes.length > 0) {
      beforeTree = await parse(grammar.language, prefix + before.text, pause);
      collect(beforeTree, offset, before, tokens, (index) => lines[index]!.kind === "del");
    }
    if (after.indexes.length > 0) {
      const fragments =
        beforeTree === null
          ? undefined
          : TreeFragment.applyChanges(TreeFragment.addTree(beforeTree), changedRanges(lines, hunk, offset, before.text.length, after.text.length));
      collect(await parse(grammar.language, prefix + after.text, pause, fragments), offset, after, tokens, () => true);
    }
    start = end;
  }
  return tokens;
};

/** Diffs larger than this stay plain: colouring them would cost more than it helps. */
export const MAX_LINES = 4000;
export const MAX_CHARACTERS = 400_000;
const CACHE_SIZE = 100;

const cache = new Map<string, Promise<DiffSyntax | null>>();

/**
 * Colours for a file's diff, or null when the file has no known language or the
 * diff is too large. Cached by path and diff text (the latest 100), so a refresh that
 * brings the same diff costs nothing.
 */
export const diffSyntax = (path: string, diff: string, lines: ReadonlyArray<DiffLine>, pause?: Pause): Promise<DiffSyntax | null> => {
  if (lines.length > MAX_LINES || diff.length > MAX_CHARACTERS) return Promise.resolve(null);
  const key = `${path}\0${diff}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    // Most recently used last, so the oldest is dropped first.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const result = grammarFor(path).then((grammar) => (grammar === null ? null : highlightDiff(lines, grammar, pause)));
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return result;
};
