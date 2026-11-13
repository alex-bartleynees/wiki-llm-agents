import type { KnowledgeSource } from "@wiki-agents/contracts/agents/model";
import { Effect, Option } from "effect";
import { AgentCatalog } from "../agents/catalog.js";
import { inScope, type VaultScope, vaultScope, WHOLE_VAULT } from "../agents/sources.js";
import { ThreadRepository } from "../threads/repository.js";
import { VaultRepository } from "../vaults/repository.js";
import { VaultCaller } from "./auth.js";
import { ToolFailure } from "./tools/shared.js";

/**
 * What the calling thread's agent may reach in the thread's vault, from its
 * knowledge sources, read at each call so an edit to the agent applies at once.
 * A thread without an agent, or an agent without sources, reaches the whole vault.
 * An agent that has gone missing reaches nothing until the thread gets another.
 */
export const callerScope = Effect.gen(function* () {
  const { threadId, vaultId } = yield* VaultCaller;
  const thread = yield* (yield* ThreadRepository).find(threadId);
  const agentId = Option.getOrUndefined(thread)?.agentId ?? null;
  if (agentId === null) return WHOLE_VAULT;
  const agent = yield* (yield* AgentCatalog).get(agentId).pipe(Effect.option);
  if (Option.isNone(agent)) return { _tag: "none" } satisfies VaultScope;
  const vault = yield* (yield* VaultRepository).findById(vaultId);
  return vaultScope(agent.value.sources, Option.getOrUndefined(vault)?.name ?? "");
});

/** The sources as the agent's file lists them, for messages. */
const describeSources = (sources: ReadonlyArray<KnowledgeSource>) =>
  sources.map((source) => (typeof source === "string" ? source : source.folders.length === 0 ? source.vault : `${source.vault} (${source.folders.join(", ")})`)).join("; ");

/** Why the vault tools refuse, for an agent whose sources leave this vault out. */
const notASource = Effect.gen(function* () {
  const { threadId } = yield* VaultCaller;
  const thread = yield* (yield* ThreadRepository).find(threadId);
  const agentId = Option.getOrUndefined(thread)?.agentId ?? null;
  const agent = agentId === null ? Option.none() : yield* (yield* AgentCatalog).get(agentId).pipe(Effect.option);
  return new ToolFailure({
    message: Option.isNone(agent)
      ? "This thread's agent is missing, so the vault tools are off until the thread gets another agent."
      : `This vault isn't one of the ${agent.value.name} agent's knowledge sources (${describeSources(agent.value.sources) || "none"}), so the vault tools can't read it.`,
  });
});

/** The caller's scope, failing when it reaches nothing in this vault. */
export const usableScope = Effect.gen(function* () {
  const scope = yield* callerScope;
  if (scope._tag === "none") return yield* Effect.flatMap(notASource, Effect.fail);
  return scope;
}).pipe(Effect.catchTag("DbError", () => Effect.fail(new ToolFailure({ message: "The app's database couldn't be read just now." }))));

/** The folders a scoped search or listing is limited to; undefined for the whole vault. */
export const scopeFolders = (scope: VaultScope) => (scope._tag === "folders" ? scope.folders : undefined);

/** Fails unless `path` is inside the scope. */
export const requireInScope = (scope: VaultScope, path: string) =>
  inScope(scope, path)
    ? Effect.void
    : Effect.fail(
        new ToolFailure({
          message: `"${path}" is outside the folders this agent may use (${scope._tag === "folders" ? scope.folders.join(", ") : "none"}).`,
        }),
      );

/** A notice for results limited to the agent's folders. */
export const scopeNotices = (scope: VaultScope): ReadonlyArray<string> =>
  scope._tag === "folders" ? [`Limited to this agent's folders: ${scope.folders.join(", ")}.`] : [];
