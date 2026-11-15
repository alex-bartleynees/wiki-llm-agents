import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { loadContext } from "../../../threads/note-context.js";
import { ThreadActors } from "../../../threads/thread-actors.js";
import { VaultCaller } from "../../auth.js";
import { requireInScope, usableScope } from "../../scope.js";
import { Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
export const VaultReadNote = vaultTool(Tool.make("vault_read_note", {
  description: "Read a selected note on demand, recording its exact version in the running turn. Reads keep 16,000 characters by default; full: true reads up to 1,000,000 for version-checked edits. A heading or truncated read cannot prepare replacement.",
  parameters: Schema.Struct({ path: VaultPath, heading: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())), full: Schema.optionalKey(Schema.Boolean).annotate({ description: "Read up to 1,000,000 characters of source for editing a large note. Check notices for truncation." }) }),
  success: Schema.Struct({ path: Schema.String, content: Schema.String, hash: Schema.String, notices: Notices }),
  failure: ToolFailure, dependencies: [VaultCaller],
}));
export const vaultReadNote = Effect.fnUntraced(function* (params: typeof VaultReadNote.parametersSchema.Type) {
  const caller = yield* VaultCaller;
  yield* requireInScope(yield* usableScope, params.path);
  const note = yield* loadContext(caller.vaultId, params, "retrieved", params.heading, params.full === true ? 1_000_000 : 16_000);
  yield* (yield* ThreadActors).recordContext(caller.threadId, note);
  return note;
}, Effect.catch((error) => error._tag === "ToolFailure" ? Effect.fail(error) : Effect.fail(new ToolFailure({ message: error._tag === "NoTurnRunning" ? "Notes can only be retrieved during a turn." : `Could not read this note (${error._tag}). Check its path with vault_search.` }))));
