import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Result, Schema, SchemaIssue } from "effect";
import { parse as parseYaml } from "yaml";

/** An agent as its file defines it; see `contracts/agents/model.ts`. */
export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly sources: ReadonlyArray<string>;
  readonly autonomy: Autonomy;
  readonly concurrency: number;
  readonly path: string;
  /** The file's body, as markdown. */
  readonly instructions: string;
}

/** A rules file: its body goes to every agent. */
export interface RulesDefinition {
  readonly id: string;
  readonly path: string;
  readonly text: string;
}

/** `always` and `never`, as the design notes write them, mean `allow` and `deny`. */
const Level = Schema.Literals(["allow", "ask", "deny", "always", "never"]);
const LEVEL_ALIASES = { always: "allow", never: "deny" } as const;

const NonEmpty = Schema.String.check(Schema.isNonEmpty());

/** Unknown keys are errors, so a typo (`comands: deny`) can't quietly leave the default. */
const Frontmatter = Schema.Struct({
  name: Schema.optionalKey(NonEmpty),
  description: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.NullOr(NonEmpty)),
  model: Schema.optionalKey(Schema.NullOr(NonEmpty)),
  sources: Schema.optionalKey(Schema.Array(NonEmpty)),
  autonomy: Schema.optionalKey(
    Schema.Struct({
      read: Schema.optionalKey(Level),
      create: Schema.optionalKey(Level),
      edit: Schema.optionalKey(Level),
      commands: Schema.optionalKey(Level),
      web: Schema.optionalKey(Level),
    }),
  ),
  concurrency: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodeFrontmatter = Schema.decodeUnknownResult(Frontmatter, { onExcessProperty: "error", errors: "all" });
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/** Bigger files are refused: instructions that long crowd out the conversation. */
export const MAX_FILE_BYTES = 64 * 1024;

/** Agent and rules ids are file names: lowercase words joined by hyphens. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Why a Syncthing conflict copy (`researcher.sync-conflict-20261110-120000-ABCDEFG.md`)
 * isn't loaded, naming the file it conflicts with; null for any other file name.
 * The config directory is meant to be synced, so edits on two machines at once make these.
 */
export const conflictCopyProblem = (fileName: string): string | null => {
  const match = /^(.*)\.sync-conflict-[^.]*\.md$/.exec(fileName);
  if (match === null) return null;
  return `A Syncthing conflict copy of ${match[1]}.md, not loaded: compare the two, keep what you want in ${match[1]}.md, and delete this copy.`;
};

/** `researcher` → `Researcher`, `code-reviewer` → `Code reviewer`. */
const nameFromId = (id: string) => {
  const words = id.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Splits `---\n<yaml>\n---\n<body>`; a file without frontmatter is all body. */
export const splitFrontmatter = (text: string): { readonly yaml: string | null; readonly body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.replace(/^﻿/, ""));
  if (match === null) return { yaml: null, body: text.trim() };
  return { yaml: match[1] ?? "", body: text.slice(match[0].length).trim() };
};

/**
 * Reads an agent file. Fails with every problem found, each naming its field, so
 * the agents screen can say exactly what to fix.
 */
export const parseAgent = (id: string, path: string, text: string): Result.Result<AgentDefinition, ReadonlyArray<string>> => {
  if (!ID_PATTERN.test(id)) return Result.fail([`The file name must be lowercase letters, digits and hyphens (got "${id}.md").`]);
  const { yaml, body } = splitFrontmatter(text);
  let raw: unknown = {};
  if (yaml !== null) {
    try {
      raw = parseYaml(yaml) ?? {};
    } catch (error) {
      return Result.fail([`The frontmatter isn't valid YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`]);
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return Result.fail(["The frontmatter must be a set of `key: value` lines."]);
  const decoded = decodeFrontmatter(raw);
  if (Result.isFailure(decoded)) {
    const { issues } = formatIssue(decoded.failure.issue);
    return Result.fail(
      issues.map((issue) => {
        const field = (issue.path ?? []).map((key) => (typeof key === "object" ? String(key.key) : String(key))).join(".");
        const message = issue.message === "Expected no excess property" ? "Unknown setting; check the spelling." : issue.message;
        return field === "" ? message : `${field}: ${message}`;
      }),
    );
  }
  if (body === "") return Result.fail(["The file has no instructions: write them below the frontmatter."]);
  const front = decoded.success;
  const level = (action: keyof Autonomy) => {
    const value = front.autonomy?.[action];
    if (value === undefined) return DEFAULT_AUTONOMY[action];
    return value === "always" || value === "never" ? LEVEL_ALIASES[value] : value;
  };
  return Result.succeed({
    id,
    name: front.name ?? nameFromId(id),
    description: front.description ?? "",
    provider: front.provider ?? null,
    model: front.model ?? null,
    sources: front.sources ?? [],
    autonomy: { read: level("read"), create: level("create"), edit: level("edit"), commands: level("commands"), web: level("web") },
    concurrency: front.concurrency ?? 1,
    path,
    instructions: body,
  });
};

/** Reads a rules file: its body, without any frontmatter. */
export const parseRules = (id: string, path: string, text: string): Result.Result<RulesDefinition, ReadonlyArray<string>> => {
  if (!ID_PATTERN.test(id)) return Result.fail([`The file name must be lowercase letters, digits and hyphens (got "${id}.md").`]);
  const { body } = splitFrontmatter(text);
  if (body === "") return Result.fail(["The rules file is empty."]);
  return Result.succeed({ id, path, text: body });
};
