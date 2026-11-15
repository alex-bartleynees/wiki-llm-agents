import { basename, relative } from "node:path";
import { createTwoFilesPatch } from "diff";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { ContextNote } from "@wiki-agents/contracts/threads/context";
import type { RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Data, Effect, FileSystem, Option } from "effect";
import { normaliseVaultPath, resolveNewInVault } from "../../../shared/vault/path-guard.js";
import { AgentCatalog } from "../../agents/catalog.js";
import { effectiveAutonomy, inScope, vaultScope, WHOLE_VAULT } from "../../agents/sources.js";
import { editWarnings } from "../../changes/edit-warnings.js";
import { findVault } from "../../vaults/find-vault.js";
import { NoteChangedOnDisk } from "../errors.js";
import { findNoteSource, requireNotePath, sha256 } from "../note-source.js";
import type { SaveNoteInput } from "../save-note/use-case.js";

export class AgentNoteWriteRefused extends Data.TaggedError("AgentNoteWriteRefused")<{ readonly message: string }> {}
export type AgentNoteWrite = Omit<SaveNoteInput, "vaultId" | "turnId">;
const refuse = (message: string) => Effect.fail(new AgentNoteWriteRefused({ message }));

/** Identifies one complete source read: a note's path and exact version. */
export const completeReadKey = (path: string, hash: string) => `${hash}:${path}`;

/**
 * The key of a read that can authorize a replacement, if `note` is one: retrieved by
 * the agent, the whole note (no heading), untruncated, and its content is the version.
 */
export const completeRead = (note: ContextNote): string | undefined =>
  note.reason === "retrieved" && note.heading === null && note.notices.length === 0 && sha256(new TextEncoder().encode(note.content)) === note.hash
    ? completeReadKey(note.path, note.hash)
    : undefined;

/** Agent instruction files, which vault write tools never change (any folder, any case). */
const PROTECTED_NOTE_NAMES = ["agents.md", "claude.md"];

/**
 * Read current permissions on every attempt, including after approval. `agentId` is the
 * thread's current agent; `completeReads` holds the `completeRead` keys of the calling turn.
 */
export const prepareAgentNoteWrite = Effect.fnUntraced(function* (agentId: string | null, vaultId: string, turnId: string, input: AgentNoteWrite, completeReads: ReadonlySet<string>) {
  const path = normaliseVaultPath(input.path);
  if (path === undefined) return yield* refuse("Use a visible vault-relative note path without traversal.");
  yield* requireNotePath(path);
  const vault = yield* findVault(vaultId);
  const target = yield* resolveNewInVault(vault.rootPath, path);
  const existing = yield* findNoteSource(vault.rootPath, path);
  // Check both the named path and its symlink target, so aliases cannot bypass scope or protected names.
  const actual = Option.isSome(existing) ? existing.value.absolute : target;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(vault.rootPath);
  const actualPath = relative(root, actual).split("\\").join("/");
  for (const candidate of [path, actualPath]) {
    if (PROTECTED_NOTE_NAMES.includes(basename(candidate).toLowerCase())) return yield* refuse("Instruction files are protected from vault write tools.");
  }
  const agent = agentId === null ? null : yield* (yield* AgentCatalog).get(agentId);
  const scope = agent === null ? WHOLE_VAULT : vaultScope(agent.sources, vault.name);
  if (![path, actualPath].every((candidate) => inScope(scope, candidate))) return yield* refuse("This note is outside the current agent's allowed vault folders.");
  const autonomy = agent === null ? DEFAULT_AUTONOMY : effectiveAutonomy(agent);
  const action = input.baseHash === null ? "create" : "edit";
  const permission = autonomy[action];
  if (permission === "deny") return yield* refuse(`The current agent denies ${action} operations.`);
  if ((Option.getOrUndefined(existing)?.hash ?? null) !== input.baseHash) return yield* new NoteChangedOnDisk({ path });
  if (input.baseHash !== null && !completeReads.has(completeReadKey(path, input.baseHash))) {
    return yield* refuse("Edit requires a complete vault_read_note of this version in the current turn. Read without a heading, using full: true if needed; truncated or partial reads cannot authorize replacement.");
  }
  const before = Option.isSome(existing) ? new TextDecoder().decode(existing.value.bytes) : "";
  const patch = createTwoFilesPatch(path, path, before, input.content, "", "", { context: 3 });
  const prompt: RequestPrompt = { _tag: "approval", title: `${action === "create" ? "Create" : "Edit"} ${path}`, detail: patch, edits: [{ path, patch, warnings: editWarnings(path, before, input.content) }] };
  return { permission, prompt, input: { ...input, path, vaultId, turnId } };
});
