import { createHash } from "node:crypto";
import type { NoteReference, ContextNote } from "@wiki-agents/contracts/threads/context";
import { Effect, FileSystem } from "effect";
import { findVault } from "../vaults/find-vault.js";
import { resolveInVault } from "../../shared/vault/path-guard.js";
import { InvalidVaultPath } from "../../shared/vault/errors.js";

/** Exact content hash; a selection is verified against the current file before inclusion. */
export const loadContext = Effect.fnUntraced(function* (vaultId: string, reference: typeof NoteReference.Type, reason: ContextNote["reason"] = "supplied", heading?: string) {
  const vault = yield* findVault(vaultId);
  if (!reference.path.toLowerCase().endsWith(".md")) return yield* new InvalidVaultPath({ path: reference.path });
  const { path, absolute } = yield* resolveInVault(vault.rootPath, reference.path);
  const markdown = yield* (yield* FileSystem.FileSystem).readFileString(absolute);
  if (reference.selection !== undefined && !markdown.includes(reference.selection)) return yield* new InvalidVaultPath({ path: reference.path });
  let selected = reference.selection ?? markdown;
  if (heading !== undefined) {
    const lines = markdown.split("\n");
    let start = -1, end = lines.length, depth = 0, fenced = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) continue;
      if (start < 0 && match[2]!.toLowerCase() === heading.toLowerCase()) { start = index; depth = match[1]!.length; }
      else if (start >= 0 && match[1]!.length <= depth) { end = index; break; }
    }
    if (start < 0) return yield* new InvalidVaultPath({ path: `${path}#${heading}` });
    selected = lines.slice(start, end).join("\n");
  }
  const content = selected.slice(0, 16000);
  return { path, heading: heading ?? null, reason, hash: createHash("sha256").update(markdown).digest("hex"), content,
    notices: selected.length > content.length ? ["Note context truncated to 16000 characters; read the file for the remainder."] : [] } satisfies ContextNote;
});
