import { basename, dirname, join, relative, sep } from "node:path";
import type { Instruction } from "../port.js";

/** `dir` is `cwd` or one of its parents. */
const isAncestorOrSelf = (dir: string, cwd: string) => {
  const path = relative(dir, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
};

/**
 * Codex reads `AGENTS.md` itself: from the session's folder up to the root of its git
 * repository (only the folder itself outside one). Sending a file it loads anyway
 * would give the model the same rules twice. `gitRoot` is the repository holding
 * `cwd`, or null.
 */
export const loadedByCodex = (instruction: Instruction, cwd: string, gitRoot: string | null) => {
  if (basename(instruction.path) !== "AGENTS.md") return false;
  const dir = dirname(instruction.path);
  if (dir === cwd) return true;
  return gitRoot !== null && isAncestorOrSelf(dir, cwd) && isAncestorOrSelf(gitRoot, dir);
};

/** The nearest folder from `cwd` up that has `.git`, by `exists`. */
export const findGitRoot = (cwd: string, exists: (path: string) => boolean): string | null => {
  let dir = cwd;
  while (true) {
    if (exists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const SUBAGENT_QUESTIONS = [
  "When delegating, tell the subagent to return any blocking question, the answer choices, and enough context to resume. A native Codex subagent may lack the user-input tool.",
  "If you are the parent and the child reports a blocking question, call your own request_user_input tool before ending your turn. Put the child's name or role in both the header and question text so the user can see who asked.",
  "Send the user's answer back to the same native subagent and let it resume the task. If the user supplies no answer, tell the child that the question remains unanswered.",
].join("\n");

/**
 * The app's instructions as Codex's developer instructions, in their order (later
 * ones win).
 */
export const developerInstructions = (instructions: ReadonlyArray<Instruction>, cwd: string, gitRoot: string | null): string => {
  const sent = instructions.filter((instruction) => !loadedByCodex(instruction, cwd, gitRoot));
  return [
    "The app you are running in adds these instructions. Where they disagree, later sections win.",
    `<instructions source="Codex subagent questions">\n${SUBAGENT_QUESTIONS}\n</instructions>`,
    ...sent.map((instruction) => `<instructions source="${instruction.title}">\n${instruction.text.trim()}\n</instructions>`),
  ].join("\n\n");
};
