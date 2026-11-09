import type { Image, Link, Text } from "mdast";
import { visit } from "unist-util-visit";
import { parseWikilink } from "./link-resolution.js";
import { type Json, noteTitle, parseMarkdown, readTags, relativeUrlTarget, takeFrontmatter, WIKILINK } from "./syntax.js";

export type LinkKind = "wikilink" | "embed" | "markdown";

export interface ExtractedLink {
  /** The target as written, without alias or heading. Resolved separately. */
  readonly target: string;
  readonly kind: LinkKind;
}

export interface ExtractedNote {
  readonly title: string;
  readonly frontmatter: Readonly<Record<string, Json>>;
  readonly tags: ReadonlyArray<string>;
  /** The markdown after the frontmatter, for full-text search. */
  readonly body: string;
  /** Unique by kind and target, in document order. */
  readonly links: ReadonlyArray<ExtractedLink>;
}

/**
 * What the index stores about a note, without rendering it. Finds the same links as
 * the renderer: wikilinks and embeds outside code and links, and markdown links and
 * images with relative URLs. Links to headings in the same note are not links.
 */
export const extractNote = (markdown: string, path: string): ExtractedNote => {
  const tree = parseMarkdown(markdown);
  const { frontmatter, bodyStart } = takeFrontmatter(tree);
  const links = new Map<string, ExtractedLink>();
  const add = (kind: LinkKind, target: string) => {
    if (target !== "" && !links.has(`${kind}\0${target}`)) links.set(`${kind}\0${target}`, { kind, target });
  };

  visit(tree, (node, _index, parent) => {
    if (node.type === "link" || node.type === "image") {
      const url = relativeUrlTarget((node as Link | Image).url);
      if (url !== undefined) add("markdown", url.target);
    } else if (node.type === "text" && parent?.type !== "link" && parent?.type !== "linkReference") {
      for (const match of (node as Text).value.matchAll(WIKILINK)) {
        add(match[1] === "!" ? "embed" : "wikilink", parseWikilink(match[2]!).target);
      }
    }
  });

  return {
    title: noteTitle(frontmatter, path),
    frontmatter,
    tags: readTags(frontmatter),
    body: markdown.slice(bodyStart).replace(/^\r?\n/, ""),
    links: [...links.values()],
  };
};
