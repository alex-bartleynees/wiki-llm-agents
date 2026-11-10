/**
 * The `@name` being typed just before the caret, if any: `@` at the start or after a
 * space or bracket, then up to 60 characters on the same line (note names have
 * spaces). `start` is where the `@` is.
 */
export const mentionAt = (text: string, caret: number): { readonly start: number; readonly query: string } | null => {
  const match = /(?:^|[\s([])@((?:[^\s@][^\n@]{0,59})?)$/.exec(text.slice(0, caret));
  if (match === null) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
};

/** The text without the `@name` from `start` to `caret`, and where the caret goes. */
export const withoutMention = (text: string, start: number, caret: number) => {
  let before = text.slice(0, start);
  const after = text.slice(caret);
  // Don't leave two spaces where the mention was.
  if (before.endsWith(" ") && (after.startsWith(" ") || after === "")) before = before.slice(0, -1);
  return { text: before + after, caret: before.length };
};

/** A note's name for a chip: its title, else its file name without `.md`. */
export const noteName = (path: string, title?: string) => title ?? path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
