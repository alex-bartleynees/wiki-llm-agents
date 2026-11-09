import { posix } from "node:path";
import { fileKind, type NoteLink } from "@wiki-agents/contracts/notes/model";
import { slug } from "github-slugger";
import type { Image, Link, PhrasingContent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { type LinkIndex, parseWikilink, resolveLinkTarget, resolveMarkdownTarget } from "../../../shared/markdown/link-resolution.js";
import { relativeUrlTarget, WIKILINK } from "../../../shared/markdown/syntax.js";

export interface LinkContext {
  /** Vault-relative path of the note being rendered. */
  readonly path: string;
  readonly index: LinkIndex;
  /** The in-app view of a note, HTML page, or JSON file; undefined for raw files. */
  readonly viewHref: (path: string) => string | undefined;
  readonly fileHref: (path: string) => string;
}

const IMAGE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const SIZE = /^(\d+)(?:x(\d+))?$/;

const stem = (path: string) => posix.basename(path).replace(/\.md$/i, "");

const unresolved = (text: string, target: string): PhrasingContent => ({
  type: "emphasis",
  data: { hName: "span", hProperties: { className: ["wikilink", "unresolved"], title: `Unresolved: ${target}` } },
  children: [{ type: "text", value: text }],
});

const link = (url: string, text: string, className: ReadonlyArray<string>): Link => ({
  type: "link",
  url,
  data: { hProperties: { className: [...className] } },
  children: [{ type: "text", value: text }],
});

const withFragment = (href: string, heading: string | undefined) =>
  heading === undefined ? href : `${href}#${slug(heading)}`;

/**
 * Where a link to a resolved file goes: its in-app view (notes keep the heading),
 * else the raw file; and the classes that say which.
 */
const destination = (context: LinkContext, path: string, heading: string | undefined) => {
  const kind = fileKind(path);
  const view = context.viewHref(path);
  const href = view === undefined ? context.fileHref(path) : kind === "note" ? withFragment(view, heading) : view;
  return { kind, href, className: kind === "note" ? ["wikilink"] : ["wikilink", kind] };
};

/**
 * Rewrites the note's links in place and returns them:
 * - relative markdown links and images point at the note route or the file endpoint
 * - `[[wikilinks]]` (with `|alias`, `#heading`, `#^block`) become links
 * - `![[embeds]]` of images become images (`|300` or `|300x200` sets the size);
 *   other embeds become links until transclusion exists
 * - anything unresolved becomes `span.wikilink.unresolved`
 */
export const transformLinks = (tree: Root, context: LinkContext): ReadonlyArray<NoteLink> => {
  const found = new Map<string, NoteLink>();
  const record = (kind: NoteLink["kind"], target: string, path: string | undefined) =>
    found.set(`${kind}\0${target}`, { kind, target, path: path ?? null });
  const resolve = (target: string) => resolveLinkTarget(context.index, target, context.path);

  // Markdown links and images with relative URLs: `[x](Other%20Note.md#Part)`, `![](assets/a.png)`.
  visit(tree, ["link", "image"], (node, index, parent) => {
    const element = node as Link | Image;
    const relative = relativeUrlTarget(element.url);
    if (relative === undefined) return;
    const { target, fragment } = relative;
    const path = resolveMarkdownTarget(context.index, target, context.path);
    record("markdown", target, path);
    if (path === undefined) {
      if (element.type === "link" && parent !== undefined && index !== undefined) {
        const text = element.children.map((child) => ("value" in child ? child.value : "")).join("");
        parent.children.splice(index, 1, unresolved(text || target, target) as never);
      }
      return;
    }
    if (element.type === "image") {
      element.url = context.fileHref(path);
    } else {
      const { href, className } = destination(context, path, fragment);
      element.url = href;
      element.data = { hProperties: { className } };
    }
  });

  visit(tree, "text", (node: Text, index, parent) => {
    if (parent === undefined || index === undefined) return;
    if (parent.type === "link" || parent.type === "linkReference") return;
    if (!node.value.includes("[[")) return;

    const replacement: Array<PhrasingContent> = [];
    let last = 0;
    for (const match of node.value.matchAll(WIKILINK)) {
      if (match.index > last) replacement.push({ type: "text", value: node.value.slice(last, match.index) });
      last = match.index + match[0].length;
      const isEmbed = match[1] === "!";
      const parsed = parseWikilink(match[2]!);

      if (parsed.target === "") {
        // `[[#Heading]]`: a heading in this note.
        const heading = parsed.heading ?? parsed.block ?? "";
        replacement.push(link(`#${slug(heading)}`, parsed.alias ?? heading, ["wikilink"]));
        continue;
      }

      const path = resolve(parsed.target);
      record(isEmbed ? "embed" : "wikilink", parsed.target, path);
      const shown = parsed.alias ?? (parsed.heading ? `${parsed.target} > ${parsed.heading}` : parsed.target);

      if (path === undefined) {
        replacement.push(unresolved(isEmbed ? match[0] : shown, parsed.target));
      } else if (isEmbed && IMAGE.test(path)) {
        const size = parsed.alias === undefined ? null : SIZE.exec(parsed.alias);
        replacement.push({
          type: "image",
          url: context.fileHref(path),
          alt: size === null && parsed.alias !== undefined ? parsed.alias : stem(path),
          data: {
            hProperties: {
              className: ["embed"],
              ...(size?.[1] ? { width: size[1] } : {}),
              ...(size?.[2] ? { height: size[2] } : {}),
            },
          },
        });
      } else {
        const { kind, href, className } = destination(context, path, parsed.heading);
        if (kind === "note") {
          const text = isEmbed ? (parsed.alias ?? stem(path)) : shown;
          replacement.push(link(href, text, isEmbed ? [...className, "embed"] : className));
        } else {
          replacement.push(link(href, parsed.alias ?? posix.basename(path), className));
        }
      }
    }
    if (replacement.length === 0) return;
    if (last < node.value.length) replacement.push({ type: "text", value: node.value.slice(last) });
    parent.children.splice(index, 1, ...(replacement as Array<never>));
    return [SKIP, index + replacement.length];
  });

  return [...found.values()];
};
