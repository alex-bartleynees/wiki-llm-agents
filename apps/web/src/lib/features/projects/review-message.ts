import type { NumberedDiffLine } from "#lib/features/changes/diff-lines.ts";

/** A comment on one or more consecutive lines of a file's diff, kept in the browser until sent. */
export interface ReviewComment {
  readonly id: string;
  /** The working directory and the path inside it. */
  readonly directory: string;
  readonly path: string;
  /** The lines commented on, as the diff showed them when the comment was written. */
  readonly lines: ReadonlyArray<NumberedDiffLine>;
  readonly text: string;
}

const span = (numbers: ReadonlyArray<number>) => {
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return first === last ? `${first}` : `${first}-${last}`;
};

/**
 * Where a comment points: `path:12` or `path:12-14` by the lines in the working tree;
 * lines that only exist in `HEAD` (all removed) are named as such.
 */
export const location = (path: string, lines: ReadonlyArray<NumberedDiffLine>) => {
  const current = lines.flatMap((line) => (line.newLine === null ? [] : [line.newLine]));
  if (current.length > 0) return `${path}:${span(current)}`;
  const removed = lines.flatMap((line) => (line.oldLine === null ? [] : [line.oldLine]));
  return removed.length > 0 ? `${path} (removed, HEAD line${removed.length === 1 ? "" : "s"} ${span(removed)})` : path;
};

/** The path as the agent sees it: relative in the main directory (where threads run), absolute elsewhere. */
export const displayPath = (workingDirectories: ReadonlyArray<string>, directory: string, path: string) =>
  directory === workingDirectories[0] ? path : `${directory.replace(/\/+$/, "")}/${path}`;

/** A code fence longer than any run of backticks in `text`. */
const fenceFor = (text: string) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));

const firstLine = (comment: ReviewComment) => comment.lines.find((line) => line.newLine !== null)?.newLine ?? comment.lines[0]?.oldLine ?? 0;

/**
 * One message with every comment, grouped by file (in the project's directory order,
 * then by path) and in line order within a file: each as `path:line`, the quoted
 * lines as a diff, then the comment.
 */
export const reviewMessage = (workingDirectories: ReadonlyArray<string>, comments: ReadonlyArray<ReviewComment>): string => {
  const directoryOrder = (directory: string) => {
    const index = workingDirectories.indexOf(directory);
    return index === -1 ? workingDirectories.length : index;
  };
  const sorted = [...comments].sort(
    (a, b) => directoryOrder(a.directory) - directoryOrder(b.directory) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || firstLine(a) - firstLine(b),
  );
  const files: Array<{ readonly name: string; readonly comments: Array<ReviewComment> }> = [];
  for (const comment of sorted) {
    const name = displayPath(workingDirectories, comment.directory, comment.path);
    if (files.at(-1)?.name === name) files.at(-1)!.comments.push(comment);
    else files.push({ name, comments: [comment] });
  }
  const count = comments.length;
  const parts = [`Review comments on the working tree (compared with HEAD), ${count} ${count === 1 ? "comment" : "comments"}. Please address them:`];
  for (const file of files) {
    parts.push(`## ${file.name}`);
    for (const comment of file.comments) {
      const quoted = comment.lines.map((line) => line.line).join("\n");
      const fence = fenceFor(quoted);
      parts.push([`**${location(file.name, comment.lines)}**`, `${fence}diff`, quoted, fence, comment.text.trim()].join("\n"));
    }
  }
  return parts.join("\n\n");
};
