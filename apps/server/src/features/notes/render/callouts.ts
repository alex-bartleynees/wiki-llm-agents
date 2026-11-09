import type { Blockquote, BlockContent, DefinitionContent, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

const MARKER = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

/** Splits a paragraph's inline nodes at its first line break: title line, then the rest. */
const splitFirstLine = (nodes: ReadonlyArray<PhrasingContent>) => {
  const title: Array<PhrasingContent> = [];
  const rest: Array<PhrasingContent> = [];
  let inTitle = true;
  for (const node of nodes) {
    if (!inTitle) {
      rest.push(node);
    } else if (node.type === "break") {
      inTitle = false;
    } else if (node.type === "text" && node.value.includes("\n")) {
      const newline = node.value.indexOf("\n");
      const before = node.value.slice(0, newline);
      const after = node.value.slice(newline + 1);
      if (before !== "") title.push({ type: "text", value: before });
      if (after !== "") rest.push({ type: "text", value: after });
      inTitle = false;
    } else {
      title.push(node);
    }
  }
  return { title, rest };
};

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Obsidian callouts: a blockquote starting `> [!type] Title` becomes
 * `div.callout[data-callout=type]` with a title and a content block. `[!type]-` and
 * `[!type]+` make it foldable (`<details>`, closed or open), with no JavaScript.
 */
export const transformCallouts = (tree: Root) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const first = node.children[0];
    if (first?.type !== "paragraph") return;
    const head = first.children[0];
    if (head?.type !== "text") return;
    const match = MARKER.exec(head.value);
    if (match === null) return;
    const type = match[1]!.toLowerCase();
    const fold = match[2];

    head.value = head.value.slice(match[0].length);
    const { title, rest } = splitFirstLine(first.children);
    const hasTitle = title.some((node) => node.type !== "text" || node.value.trim() !== "");
    const body: Array<BlockContent | DefinitionContent> = [
      ...(rest.length > 0 ? [{ type: "paragraph" as const, children: rest }] : []),
      ...node.children.slice(1),
    ];

    node.data = {
      hName: fold ? "details" : "div",
      hProperties: { className: ["callout"], dataCallout: type, ...(fold === "+" ? { open: true } : {}) },
    };
    node.children = [
      {
        type: "paragraph",
        data: { hName: fold ? "summary" : "div", hProperties: { className: ["callout-title"] } },
        children: hasTitle ? title : [{ type: "text", value: capitalise(type) }],
      },
      {
        type: "blockquote",
        data: { hName: "div", hProperties: { className: ["callout-content"] } },
        children: body,
      },
    ];
  });
};
