import { Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { loadContext } from "../../../threads/note-context.js";
import { ThreadActors } from "../../../threads/thread-actors.js";
import { VaultCaller } from "../../auth.js";
import { requireInScope, usableScope } from "../../scope.js";
import { Notices, ToolFailure, VaultPath, vaultTool } from "../shared.js";
export const VaultReadNote = vaultTool(Tool.make("vault_read_note", {
  description: "Read a selected note on demand, recording its exact version in the running turn. Content is bounded; read the file for the remainder when truncated.",
  parameters: Schema.Struct({ path: VaultPath, heading: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())) }),
  success: Schema.Struct({ path: Schema.String, content: Schema.String, hash: Schema.String, notices: Notices }),
  failure: ToolFailure, dependencies: [VaultCaller],
}));
export const vaultReadNote = Effect.fnUntraced(function* (params: typeof VaultReadNote.parametersSchema.Type) {
  const caller = yield* VaultCaller;
  yield* requireInScope(yield* usableScope, params.path);
  const note = yield* loadContext(caller.vaultId, params, "retrieved", params.heading);
  yield* (yield* ThreadActors).recordContext(caller.threadId, note);
  return note;
}, Effect.catch((error) => error._tag === "ToolFailure" ? Effect.fail(error) : Effect.fail(new ToolFailure({ message: error._tag === "NoTurnRunning" ? "Notes can only be retrieved during a turn." : `Could not read this note (${error._tag}). Check its path with vault_search.` }))));
