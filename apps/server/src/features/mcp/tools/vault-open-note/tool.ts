import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { getNote } from "../../../notes/get-note/use-case.js";
import { resolveLinks } from "../../../notes/resolve-links/use-case.js";
import { ThreadActors } from "../../../threads/thread-actors.js";
import { VaultCaller } from "../../auth.js";
import { indexUnavailable, Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
import { citation } from "../vault-note-info/tool.js";

export const VaultOpenNote = vaultTool(
  Tool.make("vault_open_note", {
    description:
      "Opens a note in the user's app, beside this conversation, optionally at a heading. Use it to show the user the note you are talking about.",
    parameters: Schema.Struct({
      path: VaultPath,
      heading: Schema.optionalKey(
        Schema.String.check(Schema.isNonEmpty()).annotate({ description: "A heading in the note, as written (vault_note_info lists them)." }),
      ),
    }),
    success: Schema.Struct({ path: Schema.String, title: Schema.String, heading: Schema.NullOr(Schema.String), notices: Notices }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
  // It changes what the user sees, not the vault.
).annotate(Tool.Idempotent, true);

export const vaultOpenNote = Effect.fnUntraced(function* (params: typeof VaultOpenNote.parametersSchema.Type) {
  const { vaultId, threadId } = yield* VaultCaller;
  if (!params.path.toLowerCase().endsWith(".md")) {
    return yield* new ToolFailure({ message: `"${params.path}" isn't a note; vault_open_note opens markdown files (.md).` });
  }
  const note = yield* getNote({ vaultId, path: params.path });
  const notices: Array<string> = [];
  let heading: string | null = null;
  if (params.heading !== undefined) {
    const wanted = params.heading.trim().toLowerCase();
    const match = note.headings.find((candidate) => candidate.text.trim().toLowerCase() === wanted);
    if (match === undefined) {
      notices.push(
        `"${note.title}" has no heading "${params.heading}", so it opened at the top. Its headings: ${note.headings.map((candidate) => candidate.text).join(" · ") || "none"}.`,
      );
    } else {
      heading = match.text;
    }
  }
  const [resolved] = (yield* resolveLinks({ vaultId, links: [{ link: citation(note.path, heading ?? undefined) }] })).links;
  const href = resolved?.href ?? null;
  if (href === null) return yield* new ToolFailure({ message: `"${note.path}" couldn't be opened.` });
  yield* (yield* ThreadActors).openNote(threadId, { path: note.path, title: note.title, heading, href });
  return { path: note.path, title: note.title, heading, notices };
}, Effect.catchTags({
  DbError: () => Effect.fail(indexUnavailable()),
  InvalidVaultPath: (error) => Effect.fail(new ToolFailure({ message: `"${error.path}" isn't a path inside the vault.` })),
  VaultFileNotFound: (error) =>
    Effect.fail(new ToolFailure({ message: `There is no note at "${error.path}". Find it with vault_search or vault_resolve_link.` })),
  VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
  PlatformError: (error) => Effect.fail(new ToolFailure({ message: `The note couldn't be read (${error.reason._tag}).` })),
  NoTurnRunning: () => Effect.fail(new ToolFailure({ message: "Notes can only be opened during a turn." })),
  ThreadNotFound: () => Effect.fail(new ToolFailure({ message: "This thread no longer exists." })),
  ProviderInstanceNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's provider is no longer configured." })),
}));
