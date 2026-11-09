import type { Heading, NoteLink } from "@wiki-agents/contracts/notes/model";
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Root } from "mdast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { type Json, noteTitle, parseMarkdown, readTags, takeFrontmatter } from "../../../shared/markdown/syntax.js";
import { transformCallouts } from "./callouts.js";
import { type LinkContext, transformLinks } from "./links.js";
import { sanitizeSchema } from "./sanitize-schema.js";

export interface RenderedNote {
  readonly title: string;
  readonly html: string;
  readonly frontmatter: Readonly<Record<string, Json>>;
  readonly tags: ReadonlyArray<string>;
  readonly links: ReadonlyArray<NoteLink>;
  readonly headings: ReadonlyArray<Heading>;
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

const toHtml = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(addHeadingIdsAndExternalLinks)
  .use(rehypeStringify)
  .freeze();

/** Headings with the ids `addHeadingIdsAndExternalLinks` gave them, in document order. */
const collectHeadings = (tree: HastRoot): Array<Heading> => {
  const headings: Array<Heading> = [];
  visit(tree, "element", (node: Element) => {
    if (HEADING.test(node.tagName) && typeof node.properties.id === "string") {
      const text = textOf(node).replace(/\s+/g, " ").trim();
      if (text !== "") headings.push({ depth: Number(node.tagName.slice(1)), text, id: node.properties.id });
    }
  });
  return headings;
};

/**
 * Renders an Obsidian note to sanitised HTML: GFM, frontmatter, callouts, wikilinks,
 * embeds, and raw HTML (sanitised). Pure: everything it needs is in the context.
 */
export const renderNote = (markdown: string, context: LinkContext): RenderedNote => {
  const tree: Root = parseMarkdown(markdown);
  const { frontmatter } = takeFrontmatter(tree);
  transformCallouts(tree);
  const links = transformLinks(tree, context);
  const hast = toHtml.runSync(tree) as HastRoot;
  const html = toHtml.stringify(hast);
  const headings = collectHeadings(hast);
  return { title: noteTitle(frontmatter, context.path), html, frontmatter, tags: readTags(frontmatter), links, headings };
};
