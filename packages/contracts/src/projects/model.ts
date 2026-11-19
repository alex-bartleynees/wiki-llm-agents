import { Schema } from "effect";

/** Work outside the vault: a project's own folders and threads, using the shared vault for notes. */
export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The shared vault the project's threads use. */
  vaultId: Schema.String,
  /**
   * Main working directory first; never empty. Paths are canonical and belong to this
   * machine. A vault-only project's single working directory is its notes folder.
   */
  workingDirectories: Schema.Array(Schema.String),
  /** A folder inside the shared vault for this project's notes. */
  notesFolder: Schema.NullOr(Schema.String),
  /**
   * When it was archived (milliseconds since the epoch); null while active. Archived
   * projects leave the project switchers and take no new threads.
   */
  archivedAt: Schema.NullOr(Schema.Number),
});
export type Project = typeof Project.Type;

export const FileChange = Schema.Struct({
  /** One of the project's working directories. */
  directory: Schema.String,
  /** Relative to `directory`, with `/` separators. */
  path: Schema.String,
  status: Schema.Literals(["created", "modified", "deleted"]),
});
export type FileChange = typeof FileChange.Type;

/**
 * How a file differs from `HEAD` in git. `untracked`: new and not yet added to git
 * (not ignored); `added`: new and staged.
 */
export const DiffStatus = Schema.Literals(["added", "modified", "deleted", "renamed", "untracked"]);
export type DiffStatus = typeof DiffStatus.Type;

/** A file's changes from `HEAD`: staged and unstaged together. */
export const DiffFile = Schema.Struct({
  /** Relative to the working directory, with `/` separators. */
  path: Schema.String,
  /** The path before a rename; null otherwise. */
  oldPath: Schema.NullOr(Schema.String),
  status: DiffStatus,
  /** Binary files have no diff and no line counts. */
  binary: Schema.Boolean,
  /** Lines added and removed, counted over the whole diff even when it is cut. */
  additions: Schema.Number,
  deletions: Schema.Number,
  /**
   * Unified diff, hunks only (`@@` headers and lines, three lines of context), cut to
   * a bounded size; `truncated` says when. Empty for binary files, empty files, and
   * mode-only changes.
   */
  diff: Schema.String,
  truncated: Schema.Boolean,
  /**
   * What the file holds now (sha256 of its content, or of a symlink's target), null
   * when deleted. `commit-changes` takes it back to check the file is still what you
   * reviewed. Given for files in git directories.
   */
  hash: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type DiffFile = typeof DiffFile.Type;

/**
 * A thread's own git worktree: a checkout of the project's main directory on a new
 * branch, under the app's data directory, so the thread's changes never mix with
 * another thread's. Made and removed only when the user asks.
 */
export const Worktree = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  branch: Schema.String,
  /** The worktree's root (canonical); `git worktree remove` takes this. */
  path: Schema.String,
  /**
   * Where the thread works: the worktree's counterpart of the project's main
   * directory. The same as `path` unless the main directory is a folder inside its
   * repository.
   */
  directory: Schema.String,
  /** Milliseconds since the epoch. */
  createdAt: Schema.Number,
  /** When the app removed it; null while it exists (or was deleted outside the app). */
  removedAt: Schema.NullOr(Schema.Number),
});
export type Worktree = typeof Worktree.Type;

/** One working directory's changes. */
export const DirectoryDiff = Schema.Struct({
  /** One of the project's working directories, or a thread's worktree directory. */
  directory: Schema.String,
  /** Set when `directory` is a thread's worktree: whose, and on which branch. */
  worktree: Schema.optionalKey(Schema.Struct({ threadId: Schema.String, branch: Schema.String })),
  /**
   * Whether the directory is in a git work tree. When it is, `files` compares it with
   * `HEAD`; when not, there is no diff and `changes` is the changed-file list
   * (compared with the baseline taken at registration or the last review).
   */
  git: Schema.Boolean,
  /**
   * The commit `files` are compared with, read before them; null before the first
   * commit, absent outside git. `commit-changes` takes it back.
   */
  head: Schema.optionalKey(Schema.NullOr(Schema.String)),
  files: Schema.Array(DiffFile),
  changes: Schema.Array(FileChange),
  /**
   * Paths in this directory the user ignores in the diff review (files they change
   * but never merge), in the order they were ignored, whether or not they have
   * changes now. Their diffs are still in `files`; the screen sets them aside. A
   * worktree directory has the main directory's list.
   */
  ignored: Schema.Array(Schema.String),
});
export type DirectoryDiff = typeof DirectoryDiff.Type;

/** A file set aside in the project's diff review until the user stops ignoring it. */
export const IgnoredFile = Schema.Struct({
  /** One of the project's working directories. */
  directory: Schema.String,
  /** Relative to `directory`, with `/` separators. */
  path: Schema.String,
});
export type IgnoredFile = typeof IgnoredFile.Type;

/** A git directory's branch and how it stands against its upstream (as of the last fetch). */
export const GitStatus = Schema.Struct({
  /** One of the project's working directories in git, or a thread's worktree directory. */
  directory: Schema.String,
  /** Set when `directory` is a thread's worktree: whose, and on which branch. */
  worktree: Schema.optionalKey(Schema.Struct({ threadId: Schema.String, branch: Schema.String })),
  /** The checked-out branch; null on a detached `HEAD`. */
  branch: Schema.NullOr(Schema.String),
  /** The current commit; null before the first commit. */
  head: Schema.NullOr(Schema.String),
  /** Where **Push** sends the branch; null without an upstream. */
  upstream: Schema.NullOr(
    Schema.Struct({
      remote: Schema.String,
      /** The branch on the remote, without `refs/heads/`. */
      branch: Schema.String,
    }),
  ),
  /**
   * Commits on the branch and not on its upstream, and the other way round, as of the
   * last fetch; null without an upstream, or when the remote branch isn't known here.
   */
  ahead: Schema.NullOr(Schema.Number),
  behind: Schema.NullOr(Schema.Number),
  /**
   * The remote a branch without an upstream would be pushed to (`git push -u`):
   * `remote.pushDefault`, else `origin`, else the only remote; null when there is none.
   */
  pushRemote: Schema.NullOr(Schema.String),
});
export type GitStatus = typeof GitStatus.Type;

/** A commit the app made. */
export const CommitSummary = Schema.Struct({
  hash: Schema.String,
  shortHash: Schema.String,
  subject: Schema.String,
});
export type CommitSummary = typeof CommitSummary.Type;

/** Which provider and model write **Suggest message**; nulls for the defaults. */
export const CommitMessageSettings = Schema.Struct({
  /** Null: Claude Code on Haiku when it is ready, else the first provider. */
  providerInstanceId: Schema.NullOr(Schema.String),
  /** Null: the provider's default. Always null without a chosen provider (the default uses Haiku). */
  model: Schema.NullOr(Schema.String),
});
export type CommitMessageSettings = typeof CommitMessageSettings.Type;

/** The provider and model a suggestion uses (or used), as the settings resolve now. */
export const CommitMessageProvider = Schema.Struct({
  providerInstanceId: Schema.String,
  providerName: Schema.String,
  /** Null for the provider's default. */
  model: Schema.NullOr(Schema.String),
});
export type CommitMessageProvider = typeof CommitMessageProvider.Type;

/**
 * A name the agent types in place of a credential (`APP_PASSWORD`): capitals, digits
 * and `_`, at least four characters, so ordinary text an agent types is never one.
 */
export const SIGN_IN_VARIABLE = /^[A-Z][A-Z0-9_]{3,63}$/;

/** A secret's name in Settings › Secrets: lowercase letters, digits and hyphens. */
export const SECRET_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** One credential of a sign-in: the name the agent types, and the secret whose value the browser types instead. */
export const BrowserCredential = Schema.Struct({
  /** What the agent types, e.g. `APP_PASSWORD`; unique across the project's sign-ins. */
  variable: Schema.String,
  /** The secret's name in Settings › Secrets, e.g. `demo-password`. */
  secret: Schema.String,
});
export type BrowserCredential = typeof BrowserCredential.Type;

/**
 * A test account the built-in browser signs in to a local app with, for every thread in
 * the project. The agent is told the variables' names only; the browser types the
 * secrets' values, and only on a page at one of `origins`.
 */
export const BrowserSignIn = Schema.Struct({
  /** What you and the agent call it, e.g. "My app (local)". */
  name: Schema.String,
  /** Where its credentials may be typed: `http://localhost:3000`, and the identity provider's if the login goes there. */
  origins: Schema.Array(Schema.String),
  credentials: Schema.Array(BrowserCredential),
});
export type BrowserSignIn = typeof BrowserSignIn.Type;

/** The WHATWG `URL` every runtime here has; contracts are built without DOM or Node types. */
declare const URL: new (input: string) => { readonly protocol: string; readonly origin: string };

/** `http://localhost:3000/login` → `http://localhost:3000`; null for anything that isn't an http(s) address. */
export const originOf = (address: string): string | null => {
  try {
    const url = new URL(address.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/**
 * What is wrong with a project's sign-ins, each problem naming the sign-in, for you to
 * fix; empty when they can be saved. Origins are compared as `originOf` gives them.
 */
export const browserSignInProblems = (signIns: ReadonlyArray<BrowserSignIn>): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const names = new Set<string>();
  const variables = new Set<string>();
  signIns.forEach((signIn, index) => {
    const name = signIn.name.trim();
    const label = name === "" ? `Sign-in ${index + 1}` : `"${name}"`;
    if (name === "") problems.push(`${label}: give it a name.`);
    else if (names.has(name.toLowerCase())) problems.push(`${label}: another sign-in has this name.`);
    names.add(name.toLowerCase());
    if (signIn.origins.length === 0) problems.push(`${label}: add the site it signs in to, e.g. http://localhost:3000.`);
    for (const origin of signIn.origins) {
      if (originOf(origin) === null) problems.push(`${label}: "${origin}" isn't an http:// or https:// address.`);
    }
    if (signIn.credentials.length === 0) problems.push(`${label}: add at least one credential.`);
    for (const credential of signIn.credentials) {
      if (!SIGN_IN_VARIABLE.test(credential.variable)) {
        problems.push(`${label}: "${credential.variable}" must be 4 to 64 capital letters, digits and _, starting with a letter (e.g. APP_PASSWORD).`);
      } else if (variables.has(credential.variable)) {
        problems.push(`${label}: ${credential.variable} is used twice; each name may stand for one secret.`);
      }
      variables.add(credential.variable);
      if (!SECRET_NAME.test(credential.secret)) problems.push(`${label}: choose a secret for ${credential.variable || "each credential"}.`);
    }
  });
  return problems;
};
