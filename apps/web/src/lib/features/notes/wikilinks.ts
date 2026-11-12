/**
 * What to write between `[[` and `]]` to link to `path`: the shortest path suffix no
 * other file in the vault ends with (usually just the file name), as Obsidian's
 * "shortest path when possible". Notes drop `.md`; other files keep their extension.
 * The server resolves links the same way (`shared/markdown/link-resolution.ts`).
 */
export const wikilinkTarget = (path: string, vaultPaths: ReadonlyArray<string>): string => {
  const segments = path.split("/");
  const lowerPaths = vaultPaths.map((other) => other.toLowerCase());
  let suffix = segments.at(-1) ?? path;
  for (let kept = 1; kept < segments.length; kept++) {
    suffix = segments.slice(-kept).join("/");
    const lower = suffix.toLowerCase();
    const matches = lowerPaths.filter((other) => other === lower || other.endsWith(`/${lower}`)).length;
    if (matches <= 1) break;
    suffix = path;
  }
  return path.toLowerCase().endsWith(".md") ? suffix.slice(0, -3) : suffix;
};

/** An unfinished wikilink just before the cursor: `[[Pla` or `![[diag`. */
export interface WikilinkQuery {
  /** Where the typed target starts (after `[[`), relative to the text given. */
  readonly from: number;
  readonly query: string;
  readonly embed: boolean;
}

/** The wikilink being typed at the end of `textBefore` (the line up to the cursor), if any. */
export const wikilinkQuery = (textBefore: string): WikilinkQuery | undefined => {
  const match = /(!?)\[\[([^[\]|#\n]*)$/.exec(textBefore);
  if (match === null) return undefined;
  const query = match[2] ?? "";
  return { from: textBefore.length - query.length, query, embed: match[1] === "!" };
};
