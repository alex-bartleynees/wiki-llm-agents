import type { McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
import { Result, Schema, SchemaIssue } from "effect";
import { parse as parseYaml } from "yaml";
import { ID_PATTERN } from "../../shared/config-files.js";

/** An MCP server as its file defines it; see `contracts/mcp-servers/model.ts`. */
export type McpServerDefinition = McpServerSummary;

/** The folder in the config directory, and each file's extension: `mcp/<id>.yaml`. */
export const MCP_FOLDER = "mcp";
export const MCP_EXTENSION = ".yaml";

/** Bigger files are refused: a server's settings are a few lines. */
export const MAX_FILE_BYTES = 64 * 1024;

const NonEmpty = Schema.String.check(Schema.isNonEmpty());
const Strings = Schema.Record(Schema.String, Schema.String);

const Url = NonEmpty.check(
  Schema.makeFilter((value: string) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:" ? undefined : "An http:// or https:// address.";
    } catch {
      return "An http:// or https:// address.";
    }
  }),
);

const common = {
  title: Schema.optionalKey(NonEmpty),
  scope: Schema.optionalKey(Schema.Literals(["app", "project", "thread"])),
  default: Schema.optionalKey(Schema.Boolean),
  access: Schema.optionalKey(Schema.Literals(["allow", "ask", "deny"])),
};

/** Unknown keys are errors, so a typo (`comand: npx`) can't quietly start nothing. */
const StdioFile = Schema.Struct({
  ...common,
  transport: Schema.Struct({
    type: Schema.Literal("stdio"),
    command: NonEmpty,
    args: Schema.optionalKey(Schema.Array(Schema.String)),
    env: Schema.optionalKey(Strings),
    cwd: Schema.optionalKey(NonEmpty),
  }),
});

const HttpFile = Schema.Struct({
  ...common,
  transport: Schema.Struct({
    type: Schema.Literal("http"),
    url: Url,
    headers: Schema.optionalKey(Strings),
  }),
  oauth: Schema.optionalKey(
    Schema.Struct({
      clientId: Schema.optionalKey(NonEmpty),
      scopes: Schema.optionalKey(Schema.Array(NonEmpty.check(Schema.makeFilter((scope: string) => (/\s/.test(scope) ? "One scope per entry, without spaces." : undefined))))),
    }),
  ),
});

const options = { onExcessProperty: "error", errors: "all" } as const;
const decodeStdio = Schema.decodeUnknownResult(StdioFile, options);
const decodeHttp = Schema.decodeUnknownResult(HttpFile, options);
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const problemsOf = (issue: SchemaIssue.Issue): ReadonlyArray<string> =>
  formatIssue(issue).issues.map((found) => {
    const field = (found.path ?? []).map((key) => (typeof key === "object" ? String(key.key) : String(key))).join(".");
    const message = found.message === "Expected no excess property" ? "Unknown setting; check the spelling." : found.message;
    return field === "" ? message : `${field}: ${message}`;
  });

/** `${kind:value}` anywhere in a string. */
const REFERENCE = /\$\{([^}]*)\}/g;

/**
 * What is wrong with the references in `value` (`${secret:github}`, `${env:NAME}`,
 * `${file:/run/secrets/x}`), each problem starting with `field`. Only the app resolves
 * them, when it connects.
 */
export const referenceProblems = (field: string, value: string): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  for (const [whole, inner = ""] of value.matchAll(REFERENCE)) {
    const colon = inner.indexOf(":");
    const kind = colon < 0 ? inner : inner.slice(0, colon);
    const name = colon < 0 ? "" : inner.slice(colon + 1);
    if (kind === "secret") {
      if (!ID_PATTERN.test(name)) problems.push(`${field}: ${whole} must name a secret in lowercase letters, digits and hyphens.`);
    } else if (kind === "env") {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) problems.push(`${field}: ${whole} must name an environment variable.`);
    } else if (kind === "file") {
      if (!name.startsWith("/")) problems.push(`${field}: ${whole} must give the file's full path.`);
    } else {
      problems.push(`${field}: ${whole} isn't a reference the app knows; use \${secret:name}, \${env:NAME} or \${file:/path}.`);
    }
  }
  return problems;
};

/** Whether a server is one the app signs in to (OAuth): reached by URL, without an `Authorization` header of its own. */
export const signsIn = (server: McpServerDefinition) =>
  server.transport.type === "http" && !Object.keys(server.transport.headers).some((name) => name.toLowerCase() === "authorization");

/** `github` → `Github`, `my-browser` → `My browser`. */
const titleFromId = (id: string) => {
  const words = id.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a server file. Fails with every problem found, each naming its field, so
 * Settings can say exactly what to fix.
 */
export const parseMcpServer = (id: string, path: string, text: string): Result.Result<McpServerDefinition, ReadonlyArray<string>> => {
  if (!ID_PATTERN.test(id)) return Result.fail([`The file name must be lowercase letters, digits and hyphens (got "${id}${MCP_EXTENSION}").`]);
  let raw: unknown;
  try {
    raw = parseYaml(text.replace(/^﻿/, "")) ?? {};
  } catch (error) {
    return Result.fail([`The file isn't valid YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`]);
  }
  if (!isRecord(raw)) return Result.fail(["The file must be a set of `key: value` lines."]);
  if (!isRecord(raw.transport)) return Result.fail(["transport: Say how to reach the server: `type: stdio` with a `command`, or `type: http` with a `url`."]);
  const type = raw.transport.type;
  if (type !== "stdio" && type !== "http") return Result.fail(["transport.type: Set it to `stdio` (a command the app runs) or `http` (a URL)."]);
  if (type === "stdio" && "oauth" in raw) return Result.fail(["oauth: Only a server reached by URL (`type: http`) signs in."]);

  const decoded: Result.Result<typeof StdioFile.Type | typeof HttpFile.Type, Schema.SchemaError> = type === "stdio" ? decodeStdio(raw) : decodeHttp(raw);
  if (Result.isFailure(decoded)) return Result.fail(problemsOf(decoded.failure.issue));
  const file = decoded.success;
  const transport: McpServerDefinition["transport"] =
    file.transport.type === "stdio"
      ? { type: "stdio", command: file.transport.command, args: file.transport.args ?? [], env: file.transport.env ?? {}, cwd: file.transport.cwd ?? null }
      : { type: "http", url: file.transport.url, headers: file.transport.headers ?? {} };

  const values = transport.type === "stdio" ? Object.entries(transport.env).map(([name, value]) => [`transport.env.${name}`, value] as const) : Object.entries(transport.headers).map(([name, value]) => [`transport.headers.${name}`, value] as const);
  const problems = values.flatMap(([field, value]) => referenceProblems(field, value));
  if (problems.length > 0) return Result.fail(problems);

  return Result.succeed({
    id,
    path,
    title: file.title ?? titleFromId(id),
    transport,
    scope: file.scope ?? "app",
    default: file.default ?? false,
    access: file.access ?? null,
    oauth: "oauth" in file && file.oauth !== undefined ? { clientId: file.oauth.clientId ?? null, scopes: file.oauth.scopes ?? [] } : null,
  });
};
