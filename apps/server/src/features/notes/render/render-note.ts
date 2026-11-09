import { posix } from "node:path";
import type { NoteLink } from "@wiki-agents/contracts/notes/model";
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Root } from "mdast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import { transformCallouts } from "./callouts.js";
import { type LinkContext, transformLinks } from "./links.js";
import { sanitizeSchema } from "./sanitize-schema.js";

export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json };

export interface RenderedNote {
  readonly title: string;
  readonly html: string;
  readonly frontmatter: Readonly<Record<string, Json>>;
  readonly tags: ReadonlyArray<string>;
  readonly links: ReadonlyArray<NoteLink>;
}

const HEADING = /^h[1-6]$/;

const textOf = (node: Element | ElementContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** Runs after sanitising, so the ids and attributes it adds are the renderer's own. */
const addHeadingIdsAndExternalLinks = () => (tree: HastRoot) => {
  const slugger = new GithubSlugger();
  visit(tree, "element", (node: Element) => {
    if (HEADING.test(node.tagName)) {
      node.properties.id = slugger.slug(textOf(node));
    } else if (node.tagName === "a" && typeof node.properties.href === "string" && /^https?:/i.test(node.properties.href)) {
      node.properties.target = "_blank";
      node.properties.rel = ["noopener", "noreferrer"];
    }
  });
};

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).freeze();

const toHtml = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(addHeadingIdsAndExternalLinks)
  .use(rehypeStringify)
  .freeze();

/** YAML frontmatter as JSON; invalid YAML or a non-object yields `{}`, as Obsidian shows nothing. */
const readFrontmatter = (tree: Root): Record<string, Json> => {
  const node = tree.children[0];
  if (node?.type !== "yaml") return {};
  tree.children.shift();
  try {
    const value: unknown = JSON.parse(JSON.stringify(parseYaml(node.value) ?? {}));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, Json>) : {};
  } catch {
    return {};
  }
};

/** `tags: [a, "#b"]`, `tags: a, b`, or `tags: a b` → `["a", "b"]`. */
const readTags = (frontmatter: Readonly<Record<string, Json>>): ReadonlyArray<string> => {
  const raw = frontmatter.tags ?? frontmatter.tag;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const tags = values
    .filter((value): value is string => typeof value === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter((tag) => tag !== "");
  return [...new Set(tags)];
};

/**
 * Renders an Obsidian note to sanitised HTML: GFM, frontmatter, callouts, wikilinks,
 * embeds, and raw HTML (sanitised). Pure: everything it needs is in the context.
 */
export const renderNote = (markdown: string, context: LinkContext): RenderedNote => {
  const tree = parser.runSync(parser.parse(markdown)) as Root;
  const frontmatter = readFrontmatter(tree);
  transformCallouts(tree);
  const links = transformLinks(tree, context);
  const html = toHtml.stringify(toHtml.runSync(tree) as HastRoot);
  const title =
    typeof frontmatter.title === "string" && frontmatter.title.trim() !== ""
      ? frontmatter.title.trim()
      : posix.basename(context.path).replace(/\.md$/i, "");
  return { title, html, frontmatter, tags: readTags(frontmatter), links };
};
