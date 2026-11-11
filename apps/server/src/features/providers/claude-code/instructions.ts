import { basename, dirname, relative, sep } from "node:path";
import type { Instruction } from "../port.js";

/** `dir` is `cwd` or one of its parents. */
const isAncestorOrSelf = (dir: string, cwd: string) => {
  const path = relative(dir, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
};

/**
 * Claude Code reads `AGENTS.md` (and `CLAUDE.md`) itself, from the session's folder
 * up through its parents. Sending a file it loads anyway would give the model the
 * same rules twice.
 */
export const loadedByClaudeCode = (instruction: Instruction, cwd: string) =>
  ["AGENTS.md", "CLAUDE.md"].includes(basename(instruction.path)) && isAncestorOrSelf(dirname(instruction.path), cwd);

/**
 * The app's instructions as text appended to Claude Code's own system prompt, in
 * their order (later ones win). Null when there is nothing to send.
 */
export const appendedPrompt = (instructions: ReadonlyArray<Instruction>, cwd: string): string | null => {
  const sent = instructions.filter((instruction) => !loadedByClaudeCode(instruction, cwd));
  if (sent.length === 0) return null;
  return [
    "The app you are running in adds these instructions. Where they disagree, later sections win.",
    ...sent.map((instruction) => `<instructions source="${instruction.title}">\n${instruction.text.trim()}\n</instructions>`),
  ].join("\n\n");
};
