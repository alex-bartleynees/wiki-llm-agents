import type { SnippetPart } from "@wiki-agents/contracts/search/model";

/** Splits text into marked and unmarked parts from the indices of matched characters. */
export const highlightParts = (text: string, positions: ReadonlyArray<number>): Array<SnippetPart> => {
  const marked = new Set(positions);
  const parts: Array<SnippetPart> = [];
  for (let index = 0; index < text.length; index++) {
    const match = marked.has(index);
    const last = parts.at(-1);
    if (last !== undefined && last.match === match) parts[parts.length - 1] = { text: last.text + text[index], match };
    else parts.push({ text: text[index]!, match });
  }
  return parts;
};

/** The folder part of a vault path, or "" at the root. */
export const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
