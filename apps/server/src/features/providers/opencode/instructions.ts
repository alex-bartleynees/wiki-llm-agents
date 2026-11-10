import { basename, dirname, relative, sep } from "node:path";
import type { Instruction } from "../port.js";

/** The session instruction entry the app owns; OpenCode shows it to the model as `<context key="wiki-agents">`. */
export const INSTRUCTIONS_KEY = "wiki-agents";

/** OpenCode refuses entries over 256 KiB. */
export const MAX_INSTRUCTIONS_BYTES = 262_144;

/** `dir` is `cwd` or one of its parents. */
const isAncestorOrSelf = (dir: string, cwd: string) => {
  const path = relative(dir, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
};

/**
 * OpenCode reads `AGENTS.md` itself, from the session's folder up to the project
 * root (or your home folder). Sending a file it loads anyway would give the model
 * the same rules twice.
 */
export const loadedByOpenCode = (instruction: Instruction, cwd: string) =>
  basename(instruction.path) === "AGENTS.md" && isAncestorOrSelf(dirname(instruction.path), cwd);

/**
 * The app's instructions as one entry, in their order (later ones win). One entry
 * keeps that order (OpenCode sorts entries by key) and makes a change to any of them
 * one "this supersedes the previous value" update. Null when there is nothing to send.
 */
export const instructionsText = (instructions: ReadonlyArray<Instruction>, cwd: string): string | null => {
  const sent = instructions.filter((instruction) => !loadedByOpenCode(instruction, cwd));
  if (sent.length === 0) return null;
  return [
    "The app you are running in adds these instructions. Where they disagree, later sections win.",
    ...sent.map((instruction) => `<instructions source="${instruction.title}">\n${instruction.text.trim()}\n</instructions>`),
  ].join("\n\n");
};
