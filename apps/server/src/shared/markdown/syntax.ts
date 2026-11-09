import { posix } from "node:path";
import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";

/*
 * Obsidian markdown syntax shared by rendering (notes) and indexing: one parser, one
 * reading of frontmatter, and one definition of what counts as a link, so the index
 * and the rendered note always agree.
 */

export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json };

/** `[[target]]` and `![[embed]]`; group 1 is `!` for embeds, group 2 the inner text. */
export const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

export const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * The vault target of a markdown link or image URL (`Other%20Note.md#Part` →
 * `Other Note.md` + `Part`), or undefined for external URLs and in-page anchors.
 */
export const relativeUrlTarget = (url: string): { readonly target: string; readonly fragment: string | undefined } | undefined => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || HAS_SCHEME.test(url)) return undefined;
  const hash = url.indexOf("#");
  return {
    target: safeDecode(hash === -1 ? url : url.slice(0, hash)),
    fragment: hash === -1 ? undefined : safeDecode(url.slice(hash + 1)),
  };
};

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).freeze();

export const parseMarkdown = (markdown: string): Root => parser.runSync(parser.parse(markdown)) as Root;

/**
 * Removes the YAML frontmatter node from the tree and returns it as JSON, with the
 * offset where the body starts. Invalid YAML or a non-object yields `{}`.
 */
export const takeFrontmatter = (tree: Root): { readonly frontmatter: Record<string, Json>; readonly bodyStart: number } => {
  const node = tree.children[0];
  if (node?.type !== "yaml") return { frontmatter: {}, bodyStart: 0 };
  tree.children.shift();
  const bodyStart = node.position?.end.offset ?? 0;
  try {
    const value: unknown = JSON.parse(JSON.stringify(parseYaml(node.value) ?? {}));
    const frontmatter = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, Json>) : {};
    return { frontmatter, bodyStart };
  } catch {
    return { frontmatter: {}, bodyStart };
  }
};

/** `tags: [a, "#b"]`, `tags: a, b`, or `tags: a b` → `["a", "b"]`. */
export const readTags = (frontmatter: Readonly<Record<string, Json>>): ReadonlyArray<string> => {
  const raw = frontmatter.tags ?? frontmatter.tag;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const tags = values
    .filter((value): value is string => typeof value === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter((tag) => tag !== "");
  return [...new Set(tags)];
};

/** Frontmatter `title`, else the file name without `.md`. */
export const noteTitle = (frontmatter: Readonly<Record<string, Json>>, path: string): string =>
  typeof frontmatter.title === "string" && frontmatter.title.trim() !== ""
    ? frontmatter.title.trim()
    : posix.basename(path).replace(/\.md$/i, "");
