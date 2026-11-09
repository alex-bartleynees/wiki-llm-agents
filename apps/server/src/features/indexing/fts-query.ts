import type { SnippetPart } from "@wiki-agents/contracts/search/model";

/*
 * The FTS5 side of search, kept pure so it can be tested without SQLite. User text
 * never reaches FTS5 as syntax: every word or phrase is quoted, so `AND`, `NEAR`,
 * `-`, `*`, `:`, and stray quotes are plain text.
 */

/** Something FTS5 will index: a letter or a digit. Terms without one match nothing, and an empty phrase is an error. */
const SEARCHABLE = /[\p{L}\p{N}]/u;

/** `"a phrase"` (closed or not) or a run of non-space characters. */
const TERM = /"([^"]*)"?|(\S+)/g;

const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;

/**
 * The MATCH expression for what the user typed, or undefined when there is nothing
 * to search for. Words match by prefix (results appear as you type: `effe` finds
 * Effect); `"quoted phrases"` match exactly. All terms must match.
 */
export const ftsMatch = (text: string): string | undefined => {
  const terms: Array<string> = [];
  for (const [, phrase, word] of text.matchAll(TERM)) {
    if (phrase !== undefined) {
      if (SEARCHABLE.test(phrase)) terms.push(quote(phrase));
    } else if (word !== undefined) {
      const bare = word.replaceAll('"', "");
      if (SEARCHABLE.test(bare)) terms.push(`${quote(bare)}*`);
    }
  }
  return terms.length === 0 ? undefined : terms.join(" ");
};

/** Private-use characters that mark matches in `snippet()` output; notes don't contain them. */
export const MATCH_START = "\uE000";
export const MATCH_END = "\uE001";

/** Markdown markers that are noise in a one-line passage: bold, inline code, and wikilink brackets. */
const MARKUP = /\*\*|__|`|\[\[|\]\]/g;

/**
 * Splits FTS5 `snippet()` output into marked and unmarked text, with whitespace
 * (newlines) collapsed and markdown markers dropped.
 */
export const snippetParts = (raw: string): Array<SnippetPart> => {
  const parts: Array<SnippetPart> = [];
  const push = (text: string, match: boolean) => {
    const collapsed = text.replace(MARKUP, "").replace(/\s+/g, " ");
    if (collapsed === "") return;
    const last = parts.at(-1);
    if (last !== undefined && last.match === match) parts[parts.length - 1] = { text: last.text + collapsed, match };
    else parts.push({ text: collapsed, match });
  };
  let rest = raw.trim();
  while (rest !== "") {
    const start = rest.indexOf(MATCH_START);
    if (start === -1) {
      push(rest, false);
      break;
    }
    push(rest.slice(0, start), false);
    const end = rest.indexOf(MATCH_END, start + 1);
    push(rest.slice(start + 1, end === -1 ? undefined : end), true);
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  return parts;
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** The start of a note's body, for results that matched by tag alone (no snippet to show). */
export const leadParts = (content: string, maxLength = 200): Array<SnippetPart> => {
  const body = content.replace(FRONTMATTER, "").replace(/\s+/g, " ").trim();
  if (body === "") return [];
  return [{ text: body.length > maxLength ? `${body.slice(0, maxLength).trimEnd()}…` : body, match: false }];
};
