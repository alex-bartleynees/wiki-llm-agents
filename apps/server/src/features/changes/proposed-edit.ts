import { isAbsolute, resolve } from "node:path";
import type { ProposedEdit } from "@wiki-agents/contracts/changes/model";
import type { RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Effect, FileSystem } from "effect";
import { applyUnifiedPatch } from "./diff.js";
import { editWarnings } from "./edit-warnings.js";

/** Warnings for one proposed edit: the file now, with the provider's patch applied. None when either can't be had. */
const warningsFor = Effect.fnUntraced(function* (cwd: string, edit: ProposedEdit) {
  const fs = yield* FileSystem.FileSystem;
  const absolute = isAbsolute(edit.path) ? edit.path : resolve(cwd, edit.path);
  const before = yield* fs.readFileString(absolute).pipe(Effect.option);
  if (before._tag === "None") return [];
  const after = applyUnifiedPatch(before.value, edit.patch);
  return after === undefined ? [] : editWarnings(edit.path, before.value, after);
});

/** An approval with file edits, with edit warnings filled in from the files as they are now. */
export const withEditWarnings = Effect.fnUntraced(function* (cwd: string, prompt: RequestPrompt) {
  if (prompt._tag !== "approval" || prompt.edits === undefined) return prompt;
  const edits = yield* Effect.forEach(prompt.edits, (edit) =>
    Effect.map(warningsFor(cwd, edit), (warnings): ProposedEdit => ({ ...edit, warnings: [...edit.warnings, ...warnings] })),
  );
  return { ...prompt, edits } satisfies RequestPrompt;
});
