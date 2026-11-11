import type { DiffFile, DiffStatus } from "@wiki-agents/contracts/projects/model";

/**
 * Turning git's output into `DiffFile`s, without running git: name-status entries,
 * the patch split per file, and diffs cut to a bounded size. Pure, so it is tested
 * without a repository.
 */

/** How much of a diff is kept. */
export interface DiffLimits {
  readonly lines: number;
  readonly chars: number;
}

/** Each file in the project's diff: enough to review most changes in place. */
export const LIST_LIMITS: DiffLimits = { lines: 1500, chars: 120_000 };
/** One file asked for on its own; past this, review it in lazygit. */
export const FILE_LIMITS: DiffLimits = { lines: 20_000, chars: 2_000_000 };
/** Diff text in one project diff; files past it come without their diff, to load one at a time. */
export const LIST_BUDGET_CHARS = 4_000_000;

/** A file `git diff --name-status -z` reported. */
export interface NameStatus {
  readonly status: Exclude<DiffStatus, "untracked">;
  readonly path: string;
  readonly oldPath: string | null;
}

/**
 * Parses `git diff --name-status -z`: a status (`M`, `A`, `D`, `T`, `U`, or `R`/`C`
 * with a score) then one path, or two for renames and copies. Copies are new files;
 * type changes and unmerged paths count as modified.
 */
export const parseNameStatus = (output: string): ReadonlyArray<NameStatus> => {
  const fields = output.split("\0");
  const entries: Array<NameStatus> = [];
  let index = 0;
  while (index < fields.length) {
    const code = fields[index++]!;
    if (code === "") continue;
    const letter = code[0]!;
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index++]!;
      const path = fields[index++]!;
      entries.push(letter === "R" ? { status: "renamed", path, oldPath } : { status: "added", path, oldPath: null });
    } else {
      const path = fields[index++]!;
      entries.push({ status: letter === "A" ? "added" : letter === "D" ? "deleted" : "modified", path, oldPath: null });
    }
  }
  return entries;
};

/** A unified patch's per-file sections, each starting at its `diff --git` line. */
export const splitPatch = (patch: string): ReadonlyArray<ReadonlyArray<string>> => {
  const sections: Array<Array<string>> = [];
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    // Content lines start with " ", "+", "-" or "\", so this only matches a file header.
    if (line.startsWith("diff --git ")) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  return sections;
};

export interface BoundedHunks {
  readonly diff: string;
  readonly additions: number;
  readonly deletions: number;
  readonly truncated: boolean;
}

/** Hunk lines cut to `limits`, at a line boundary; counts cover every line. */
export const boundHunks = (lines: ReadonlyArray<string>, limits: DiffLimits): BoundedHunks => {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  let kept = lines.slice(0, limits.lines).join("\n");
  let truncated = lines.length > limits.lines;
  if (kept.length > limits.chars) {
    kept = kept.slice(0, limits.chars);
    kept = kept.slice(0, Math.max(0, kept.lastIndexOf("\n")));
    truncated = true;
  }
  return { diff: kept, additions, deletions, truncated };
};

/** One file's section of a git patch, as a `DiffFile` for the entry git listed it as. */
export const sectionToFile = (entry: NameStatus, section: ReadonlyArray<string>, limits: DiffLimits): DiffFile => {
  const firstHunk = section.findIndex((line) => line.startsWith("@@"));
  const header = firstHunk === -1 ? section : section.slice(0, firstHunk);
  const binary = header.some((line) => line.startsWith("Binary files ") || line === "GIT binary patch");
  const hunks = firstHunk === -1 || binary ? [] : section.slice(firstHunk);
  return { ...entry, binary, ...boundHunks(hunks, limits) };
};

/** A git binary check: a NUL byte in the first 8000 bytes. */
export const looksBinary = (content: Uint8Array) => content.subarray(0, 8000).includes(0);

/** An untracked file as an all-added diff, as git would show it once added. */
export const untrackedFile = (path: string, content: Uint8Array, limits: DiffLimits): DiffFile => {
  const base = { path, oldPath: null, status: "untracked" as const };
  if (looksBinary(content)) return { ...base, binary: true, additions: 0, deletions: 0, diff: "", truncated: false };
  const text = new TextDecoder().decode(content);
  if (text === "") return { ...base, binary: false, additions: 0, deletions: 0, diff: "", truncated: false };
  const lines = text.split("\n");
  const endsWithNewline = lines.at(-1) === "";
  if (endsWithNewline) lines.pop();
  const hunk = [`@@ -0,0 +1${lines.length === 1 ? "" : `,${lines.length}`} @@`, ...lines.map((line) => "+" + line)];
  if (!endsWithNewline) hunk.push("\\ No newline at end of file");
  return { ...base, binary: false, ...boundHunks(hunk, limits) };
};

/** A file whose diff was left out to keep the whole response bounded. */
export const withoutDiff = (file: DiffFile): DiffFile => (file.diff === "" ? file : { ...file, diff: "", truncated: true });

/** A relative path that stays inside its directory: no `..`, not absolute, not empty. */
export const isInsidePath = (path: string) =>
  path !== "" && !path.startsWith("/") && !path.includes("\0") && !path.split("/").some((part) => part === ".." || part === "." || part === "");
