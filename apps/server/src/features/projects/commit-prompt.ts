import type { DiffFile } from "@wiki-agents/contracts/projects/model";
import type { DiffLimits } from "./git/index.js";

/**
 * The prompt for **Suggest message**: the ticked files' diffs, bounded, and the
 * repository's recent subjects for its style. Pure, so it is tested without git or a
 * model.
 */

/** Each file's diff in the prompt. */
export const SUGGEST_LIMITS: DiffLimits = { lines: 300, chars: 8000 };
/** Diff text in one prompt; files past it are named without their diff. */
export const SUGGEST_BUDGET_CHARS = 40_000;
/** Recent subjects shown for the repository's style. */
export const RECENT_SUBJECTS = 10;

export const COMMIT_SYSTEM = [
  "You write git commit messages for the changes you are shown. You can't run tools or read files; everything you need is in the message.",
  "Reply with the commit message only: no preamble, quotes or code fences.",
  "First line: a summary of at most 72 characters, in the imperative mood (\"Add\", \"Fix\"), without a trailing full stop. Follow the style of the recent subjects (prefixes such as `feat:` only if they use them).",
  "If the change needs explaining, add a blank line and a short body wrapped at 72 characters saying what changed and why. Leave the body out for small, obvious changes.",
].join("\n");

const describe = (file: DiffFile) => (file.oldPath === null ? `${file.status} ${file.path}` : `${file.status} ${file.oldPath} → ${file.path}`);

/** The prompt, and whether any diff was cut or left out. */
export const commitPrompt = (files: ReadonlyArray<DiffFile>, subjects: ReadonlyArray<string>, budget = SUGGEST_BUDGET_CHARS) => {
  let used = 0;
  let truncated = false;
  const sections: Array<string> = [];
  for (const file of files) {
    if (file.binary) {
      sections.push(`### ${file.path}\n(binary file)`);
      continue;
    }
    if (file.diff === "") {
      sections.push(`### ${file.path}\n(${file.status === "modified" ? "mode change only" : "empty file"})`);
      continue;
    }
    if (used + file.diff.length > budget) {
      truncated = true;
      sections.push(`### ${file.path}\n(diff left out to keep this short: +${file.additions} −${file.deletions})`);
      continue;
    }
    used += file.diff.length;
    if (file.truncated) truncated = true;
    sections.push(`### ${file.path}${file.truncated ? " (cut short)" : ""}\n${file.diff}`);
  }
  const prompt = [
    `Files to commit (${files.length}):`,
    ...files.map((file) => `- ${describe(file)}`),
    "",
    subjects.length === 0 ? "This repository has no commits yet." : "Recent commit subjects in this repository, newest first:",
    ...subjects.map((subject) => `* ${subject}`),
    "",
    "Diffs (from HEAD; new files in full):",
    ...sections,
    "",
    "Write the commit message.",
  ].join("\n");
  return { prompt, truncated };
};

/** The model's answer as a message: code fences, quotes and trailing space taken off. */
export const cleanMessage = (text: string) => {
  let message = text.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(message);
  if (fenced !== null) message = fenced[1]!.trim();
  if (message.length > 1 && /^(["'`]).*\1$/s.test(message) && !message.slice(1, -1).includes(message[0]!)) message = message.slice(1, -1).trim();
  return message
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
};
