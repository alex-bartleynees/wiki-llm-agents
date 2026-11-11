import { extractNote } from "../../shared/markdown/extract.js";

/** Below this share of the old body's length, an edit is flagged as a big cut. */
export const SHRINK_RATIO = 0.7;

/** The first ATX heading outside fenced code, without its `#`s. */
const firstHeading = (body: string): string | undefined => {
  let fence: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) return heading[1];
  }
  return undefined;
};

/**
 * Signs that an edit to a note may have damaged it: the body shrank below 70% of its
 * old length, the title or first heading changed, or frontmatter keys or tags were
 * dropped. Only for edits of existing notes (`.md`); warnings never block anything.
 */
export const editWarnings = (path: string, before: string | null, after: string | null): ReadonlyArray<string> => {
  if (before === null || after === null || !path.toLowerCase().endsWith(".md")) return [];
  const old = extractNote(before, path);
  const now = extractNote(after, path);
  const warnings: Array<string> = [];
  const oldLength = old.body.trim().length;
  const newLength = now.body.trim().length;
  if (oldLength > 0 && newLength < oldLength * SHRINK_RATIO) {
    warnings.push(`The note got much shorter: ${Math.round((newLength / oldLength) * 100)}% of its length.`);
  }
  if (old.title !== now.title) warnings.push(`The title changed from "${old.title}" to "${now.title}".`);
  const oldHeading = firstHeading(old.body);
  const newHeading = firstHeading(now.body);
  if (oldHeading !== undefined && oldHeading !== newHeading) {
    warnings.push(newHeading === undefined ? `The first heading "${oldHeading}" was removed.` : `The first heading changed from "${oldHeading}" to "${newHeading}".`);
  }
  const droppedKeys = Object.keys(old.frontmatter).filter((key) => !(key in now.frontmatter));
  if (droppedKeys.length > 0) warnings.push(`Frontmatter dropped: ${droppedKeys.join(", ")}.`);
  const newTags = new Set(now.tags.map((tag) => tag.toLowerCase()));
  const droppedTags = old.tags.filter((tag) => !newTags.has(tag.toLowerCase()));
  if (droppedTags.length > 0) warnings.push(`Tags dropped: ${droppedTags.join(", ")}.`);
  return warnings;
};
