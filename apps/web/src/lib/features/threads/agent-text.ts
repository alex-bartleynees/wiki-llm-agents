/**
 * The small part of markdown agents use in chat replies, parsed into data so it is
 * drawn with text interpolation only (never `{@html}`): paragraphs, `-`/`*` lists,
 * `**bold**`, `*italic*`, and `` `code` ``. Anything else stays as typed.
 */
export type Inline = { readonly type: "text" | "strong" | "em" | "code"; readonly text: string };
export type Block =
  | { readonly type: "p"; readonly lines: ReadonlyArray<ReadonlyArray<Inline>> }
  | { readonly type: "ul"; readonly items: ReadonlyArray<ReadonlyArray<Inline>> };

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g;

export const parseInline = (text: string): Array<Inline> =>
  text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return { type: "code", text: part.slice(1, -1) };
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return { type: "strong", text: part.slice(2, -2) };
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return { type: "em", text: part.slice(1, -1) };
      return { type: "text", text: part };
    });

const BULLET = /^\s*[-*]\s+/;

export const parseAgentText = (text: string): Array<Block> =>
  text
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((line) => line.trim() !== ""))
    .filter((lines) => lines.length > 0)
    .map((lines): Block =>
      lines.every((line) => BULLET.test(line))
        ? { type: "ul", items: lines.map((line) => parseInline(line.replace(BULLET, ""))) }
        : { type: "p", lines: lines.map(parseInline) },
    );
