import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { normaliseVaultPath } from "../../../shared/vault/path-guard.js";

/**
 * Why a tool couldn't do what it was asked, in words the agent can act on. MCP
 * returns it as an `isError` result with this message.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()("ToolFailure", {
  message: Schema.String,
}) {}

/**
 * Things the agent must know about a result: it was cut short, a limit or default
 * was applied, something is unavailable. Every tool returns them, never silently
 * pretending a request was honoured; the app shows them too.
 */
export const Notices = Schema.Array(Schema.String).annotate({
  description: "Read these: results cut short, limits applied, or features unavailable.",
});

/** Every vault tool: strict arguments (unknown keys are errors) and read-only unless said otherwise. */
export const vaultTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.Strict, true).annotate(Tool.Readonly, true).annotate(Tool.Destructive, false).annotate(Tool.OpenWorld, false) as T;

/** A whole number between `minimum` and `maximum`, described for the model. */
export const IntBetween = (minimum: number, maximum: number, description: string) =>
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum, maximum })).annotate({ description });

export const VaultPath = Schema.String.check(Schema.isNonEmpty()).annotate({
  description: "A vault-relative path with `/` separators and its extension, e.g. `Projects/Plan.md`.",
});

/** The normalised vault path, or a failure saying what was wrong with it. */
export const vaultPath = (path: string) => {
  const normalised = normaliseVaultPath(path);
  return normalised === undefined
    ? Effect.fail(new ToolFailure({ message: `"${path}" isn't a path inside the vault. Use a vault-relative path such as "Folder/Note.md".` }))
    : Effect.succeed(normalised);
};

/** Milliseconds since the epoch as an ISO 8601 timestamp. */
export const iso = (ms: number) => new Date(ms).toISOString();

/** A failure from the index or the database, without its internals. */
export const indexUnavailable = (): ToolFailure =>
  new ToolFailure({ message: "The vault index couldn't be read just now. vault_status says what is available." });
