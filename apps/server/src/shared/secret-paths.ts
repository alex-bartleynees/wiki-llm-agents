import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { isInside } from "./vault/path-guard.js";

/**
 * Checks against what no agent may reach whatever its autonomy: the files that hold
 * secrets (the stored secrets, their key, declared secret files, files MCP servers'
 * `${file:…}` references read), extra paths from `WIKI_AGENTS_PROTECTED_PATHS`, and
 * files and folders whose names match its patterns (`.env`, `.env.*` but not
 * `.env.example`, by default). The list comes from the secrets feature's
 * `SecretMaterial`.
 */
export interface Protection {
  /** Absolute paths, each in its written and canonical forms: the path and everything inside it. */
  readonly paths: ReadonlyArray<string>;
  /**
   * Name patterns matched against every part of a path, in any folder: `*` is any
   * characters but `/`, `?` one. A leading `!` makes an exception (`!.env.example`).
   */
  readonly names: ReadonlyArray<string>;
}

export const NO_PROTECTION: Protection = { paths: [], names: [] };

export const isUnprotected = (protection: Protection) => protection.paths.length === 0 && protection.names.length === 0;

/** The patterns that protect and the exceptions, without their `!`. */
export const namePatterns = (names: ReadonlyArray<string>) => ({
  match: names.filter((name) => !name.startsWith("!")),
  except: names.filter((name) => name.startsWith("!")).map((name) => name.slice(1)),
});

const patternRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*").replaceAll("?", "[^/]")}$`, "s");

/** True when a file or folder `name` matches a pattern and no exception. */
export const isProtectedName = (names: ReadonlyArray<string>, name: string) => {
  const { match, except } = namePatterns(names);
  return match.some((pattern) => patternRegex(pattern).test(name)) && !except.some((pattern) => patternRegex(pattern).test(name));
};

/** True when any part of `path` is a protected name: the file, or a folder holding it. */
const hasProtectedName = (names: ReadonlyArray<string>, path: string) => names.length > 0 && path.split(sep).some((part) => part !== "" && isProtectedName(names, part));

/** A trailing `/*` or `/**` means the folder itself. */
const folderOf = (path: string) => path.replace(/\/\*\*?$/, "");

/** `path` with symlinks resolved; a part that doesn't exist yet is kept as written below its nearest existing folder. */
const canonical = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  let existing = path;
  let rest = "";
  while (!(yield* fs.exists(existing).pipe(Effect.orElseSucceed(() => false)))) {
    const parent = dirname(existing);
    if (parent === existing) return path;
    rest = rest === "" ? basename(existing) : join(basename(existing), rest);
    existing = parent;
  }
  const real = yield* fs.realPath(existing).pipe(Effect.orElseSucceed(() => existing));
  return rest === "" ? real : join(real, rest);
});

/**
 * True when one of `paths` (relative ones from `cwd`) is protected: a protected path
 * or inside one, or a file or folder with a protected name or inside one, as written
 * or once symlinks are resolved. With `searches`, a folder holding a protected path
 * counts too: searching it would read what's inside. (Not a folder that might hold a
 * protected name: any folder might.)
 */
export const reachesProtected = Effect.fnUntraced(function* (
  protection: Protection,
  cwd: string,
  paths: ReadonlyArray<string>,
  options: { readonly searches: boolean } = { searches: false },
) {
  if (isUnprotected(protection)) return false;
  for (const input of paths) {
    const written = resolve(cwd, folderOf(input));
    for (const path of new Set([written, yield* canonical(written)])) {
      if (protection.paths.some((secret) => isInside(secret, path) || (options.searches && isInside(path, secret)))) return true;
      // Inside the working folder, only the parts below it count: a folder above it with a protected name mustn't protect everything.
      if (hasProtectedName(protection.names, isInside(cwd, path) ? relative(cwd, path) : path)) return true;
    }
  }
  return false;
});

/** How a command may write a protected path: as is, and from the home folder with `~`, `$HOME` or `${HOME}`. */
export const spellings = (path: string, home: string) => {
  if (home === "" || path === home || !isInside(home, path)) return [path];
  const rest = relative(home, path);
  return [path, `~/${rest}`, `$HOME/${rest}`, `\${HOME}/${rest}`];
};

/** A stand-in name for each pattern, to test a command's shell glob against: `*` and `?` filled in. */
const sampleNames = (names: ReadonlyArray<string>) =>
  namePatterns(names)
    .match.map((pattern) => pattern.replaceAll("*", "x").replaceAll("?", "x"))
    .filter((sample) => isProtectedName(names, sample));

/** A shell glob (`*`, `?`, `[…]`) as a regex; like the shell, it matches a leading dot only when it starts with one. */
const shellGlobMatches = (glob: string, name: string) => {
  if (name.startsWith(".") && !glob.startsWith(".")) return false;
  const source = glob
    .split(/(\[[^\]]*\])/)
    .map((part, index) =>
      index % 2 === 1
        ? part.replace(/^\[!/, "[^")
        : part.replace(/[.+^${}()|\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", "."),
    )
    .join("");
  try {
    return new RegExp(`^${source}$`, "s").test(name);
  } catch {
    return false;
  }
};

/** A command cut into its quoted (`'…'`, `"…"`) and unquoted stretches. */
const quotedStretches = (command: string) => {
  const stretches: Array<{ readonly text: string; readonly quoted: boolean }> = [];
  let text = "";
  let quote: "'" | '"' | null = null;
  const cut = (quoted: boolean) => {
    if (text !== "") stretches.push({ text, quoted });
    text = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === null && (char === "'" || char === '"')) {
      cut(false);
      quote = char;
    } else if (quote !== null && char === quote) {
      cut(true);
      quote = null;
    } else if (char === "\\" && quote !== "'" && index + 1 < command.length) {
      text += command[++index];
    } else {
      text += char;
    }
  }
  cut(quote !== null);
  return stretches;
};

/** Words a command may name a file with: split at spaces and shell operators (`=` for `--env-file=.env`). */
const words = (text: string) => text.split(/[\s;|&<>()`=,:]+/).filter((word) => word !== "");

/**
 * True when a shell command names a protected path, or a file or folder with a
 * protected name (also through a glob such as `.env*` or `.*`). Only unquoted words
 * count as globs, since only those the shell expands: a quoted `.*` is a pattern for
 * `sed` or `grep`, not files. A best effort: a command can reach a file without
 * naming it (`cd` first, a variable, a program that loads `.env` itself, `find` with
 * a quoted `-name` pattern), which only a sandbox that denies the read can stop.
 */
export const commandNamesProtected = (protection: Protection, command: string, home: string = homedir()) => {
  if (protection.paths.some((path) => spellings(path, home).some((spelling) => command.includes(spelling)))) return true;
  if (protection.names.length === 0) return false;
  const samples = sampleNames(protection.names);
  return quotedStretches(command).some(({ text, quoted }) =>
    words(text).some((word) =>
      word.split("/").some((part) =>
        !quoted && /[*?[]/.test(part) ? samples.some((sample) => shellGlobMatches(part, sample)) : part !== "" && isProtectedName(protection.names, part),
      ),
    ),
  );
};

/** A protected path as the user would recognise it: from the home folder with `~`. */
export const displayPath = (path: string, home: string = homedir()) => (home !== "" && path !== home && isInside(home, path) ? `~/${relative(home, path)}` : path);

/**
 * `WIKI_AGENTS_PROTECTED_PATHS`: entries separated by commas or new lines. An entry
 * starting with `/` or `~/` is a path (a file, or a folder and everything in it); one
 * without a `/` is a name pattern matched in any folder; `!` before a name pattern
 * makes an exception. Anything else is a problem, reported and left out.
 */
export const parseProtectedPaths = (value: string, home: string = homedir()) => {
  const paths: Array<string> = [];
  const names: Array<string> = [];
  const problems: Array<string> = [];
  for (const entry of value.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "")) {
    const name = entry.startsWith("!") ? entry.slice(1) : entry;
    if (entry.startsWith("~/") || isAbsolute(entry)) {
      if (/[*?[\]{}]/.test(entry)) problems.push(`"${entry}": a path can't have wildcards; give a name pattern without a "/" instead.`);
      else paths.push(entry.startsWith("~/") ? join(home, entry.slice(2)) : resolve(entry));
    } else if (name === "" || name.includes("/") || /[[\]{}]/.test(name)) {
      problems.push(`"${entry}": write a full path (/… or ~/…) or a name pattern without a "/" (only * and ? as wildcards).`);
    } else {
      names.push(entry);
    }
  }
  return { paths, names, problems };
};

/** The default: `.env` and `.env.*` in any folder, except `.env.example`. */
export const DEFAULT_PROTECTED_PATHS = ".env, .env.*, !.env.example";
