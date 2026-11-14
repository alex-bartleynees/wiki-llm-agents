import type { DiffLine } from "./diff-lines.ts";
// Types only: `syntax.ts` (with CodeMirror's language core) loads when a diff first needs colours.
import type { DiffSyntax, Pause, SyntaxStyle, SyntaxToken } from "./syntax.ts";

/** Yields to the browser between slices of parsing: `scheduler.yield` where there is one (input goes first), else a new task. */
const pause: Pause = () => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield !== undefined ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Syntax colours drawn with the CSS Custom Highlight API: ranges over the text that is
 * already there, styled by `::highlight(syntax-<style>)` rules in `tokens.css`. Nothing
 * is added to the DOM, so a coloured diff costs no more layout than a plain one.
 * Browsers without the API show plain text.
 */
const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function" && typeof StaticRange === "function";

/** One shared highlight per colour; every painted line adds its ranges to these. */
const highlights = new Map<SyntaxStyle, Highlight>();

const highlightFor = (style: SyntaxStyle) => {
  let highlight = highlights.get(style);
  if (highlight === undefined) {
    highlight = new Highlight();
    CSS.highlights.set(`syntax-${style}`, highlight);
    highlights.set(style, highlight);
  }
  return highlight;
};

/** An element holding one line's code, its tokens, and how many characters come before the code (a `+`/`-` sign). */
export interface PaintedLine {
  readonly element: Element;
  readonly tokens: ReadonlyArray<SyntaxToken>;
  readonly offset: number;
}

/**
 * Colours each element's text by its tokens, across however many text nodes it is
 * split into (search marks split it). Returns a function that takes the colours off.
 * Ranges are `StaticRange`s, which don't follow DOM changes, so repaint after the text
 * re-renders.
 */
export const paintSyntax = (lines: Iterable<PaintedLine>): (() => void) => {
  if (!supported()) return () => {};
  const added: Array<readonly [Highlight, StaticRange]> = [];
  for (const { element, tokens, offset } of lines) {
    if (tokens.length === 0) continue;
    const nodes: Array<Text> = [];
    const starts: Array<number> = [];
    let length = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push(node as Text);
      starts.push(length);
      length += (node as Text).length;
    }
    let first = 0;
    for (const token of tokens) {
      const from = token.from + offset;
      const to = token.to + offset;
      if (to > length) break;
      // Tokens are in order, so the node a token starts in only moves forward.
      while (first < nodes.length - 1 && starts[first + 1]! <= from) first++;
      let last = first;
      while (last < nodes.length - 1 && starts[last + 1]! < to) last++;
      const range = new StaticRange({
        startContainer: nodes[first]!,
        startOffset: from - starts[first]!,
        endContainer: nodes[last]!,
        endOffset: to - starts[last]!,
      });
      const highlight = highlightFor(token.style);
      highlight.add(range);
      added.push([highlight, range]);
    }
  }
  return () => {
    for (const [highlight, range] of added) highlight.delete(range);
  };
};

export interface DiffSyntaxOptions {
  /** The file's path, to choose a language; null to stay plain. */
  readonly path: string | null;
  readonly diff: string;
  readonly lines: ReadonlyArray<DiffLine>;
  /** The element holding the lines; each line's code is in an element with `data-line="<index>"`. */
  readonly root: HTMLElement | undefined;
  /** Whether the lines are shown (a folded file isn't). */
  readonly open: boolean;
  /** Characters before the code in each `data-line` element. */
  readonly offset: number;
  /** Anything that re-renders the lines' text, such as search marks: a change repaints. */
  readonly repaint?: unknown;
  /**
   * Load the file's grammar when the browser is idle, before the diff is on screen, so
   * colours don't wait for a download. For screens that are about diffs (the Diff
   * view), not for diffs folded away in a thread.
   */
  readonly prefetch?: boolean;
}

/** Runs `work` when the browser is idle (Safari has no `requestIdleCallback`: soon after). */
const whenIdle = (work: () => void) => {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(work, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(work, 200);
  return () => clearTimeout(id);
};

/**
 * Colours a diff once it comes near the screen and is open: tokens load (and are
 * cached) in `syntax.ts`, then are painted over the rendered lines. Call from a
 * component's script; `options` is read inside effects, so pass a getter over props.
 */
export const diffSyntaxColours = (options: () => DiffSyntaxOptions) => {
  let seen = $state(false);
  let syntax = $state.raw<{ readonly lines: ReadonlyArray<DiffLine>; readonly tokens: DiffSyntax } | null>(null);

  $effect(() => {
    const { path, prefetch } = options();
    if (prefetch !== true || path === null || !supported()) return;
    return whenIdle(() => {
      void import("./syntax.ts").then(({ grammarFor }) => grammarFor(path)).catch(() => {});
    });
  });

  // Wait until the diff is near the screen: a long review only colours what is read.
  $effect(() => {
    const { root } = options();
    if (seen || root === undefined || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          seen = true;
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  });

  $effect(() => {
    const { path, diff, lines, open } = options();
    if (!seen || !open || path === null || !supported()) return;
    let current = true;
    void import("./syntax.ts").then(({ diffSyntax }) => diffSyntax(path, diff, lines, pause)).then(
      (tokens) => {
        if (current) syntax = tokens === null ? null : { lines, tokens };
      },
      () => {},
    );
    return () => {
      current = false;
    };
  });

  $effect(() => {
    const { root, lines, open, offset, repaint } = options();
    void repaint;
    // Tokens for an older version of the lines would land on the wrong text.
    if (root === undefined || !open || syntax === null || syntax.lines !== lines) return;
    const { tokens } = syntax;
    const clear = paintSyntax(
      Array.from(root.querySelectorAll("[data-line]"), (element) => ({
        element,
        tokens: tokens[Number(element.getAttribute("data-line"))] ?? [],
        offset,
      })),
    );
    // Says the colours are drawn (for tests, and to see in dev tools).
    root.dataset["syntax"] = "on";
    return () => {
      clear();
      delete root.dataset["syntax"];
    };
  });
};
