import { WallClock } from "../../../shared/wall-clock.js";
import { randomUUID } from "node:crypto";
import type { CreateThreadRequest } from "@wiki-agents/contracts/threads/create-thread/request";
import type { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { Effect } from "effect";
import { AgentCatalog } from "../../agents/catalog.js";
import { InvalidProject } from "../../projects/errors.js";
import { findProject } from "../../projects/find-project.js";
import type { Worktree } from "@wiki-agents/contracts/projects/model";
import { createWorktree, discardWorktree, shareWorktree, unshareWorktree } from "../../projects/worktrees.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { findVault } from "../../vaults/find-vault.js";
import { applicableAgentModel, validateModel } from "../model-selection.js";
import { ThreadRepository } from "../repository.js";
import { ThreadBus } from "../thread-bus.js";

/**
 * The provider is the request's, else the agent's, else the default. The agent's
 * model is used unless explicitly overridden, when the thread runs on the agent's own provider (or the agent
 * names none). A schedule names its thread; others are named by their first message.
 * With `worktree`, git makes the thread's worktree first; if git refuses, there is no
 * thread, and if the thread can't be saved, the worktree is removed again.
 *
 * Continue in a new thread also gives the draft it starts with, the thread it
 * continues, the model to keep as it is (no agent default, not checked again), and a
 * worktree to share instead of making one.
 */
export const createThread = Effect.fn("createThread")(function* (
  request: CreateThreadRequest & { readonly vaultId: string },
  options: {
    readonly title?: string;
    readonly draftText?: string;
    readonly continuedFrom?: string;
    readonly parentThreadId?: string;
    readonly model?: string | null;
    readonly shareWorktree?: Worktree;
    readonly childModelSource?: "explicit" | "agent-default" | "provider-default";
  } = {},
) {
  const vault = yield* findVault(request.vaultId);
  const project = request.projectId === undefined ? null : yield* findProject(request.projectId);
  if (project !== null && project.vaultId !== vault.id) return yield* new InvalidProject({ message: "Project uses a different shared vault" });
  if (project?.archivedAt != null) return yield* new InvalidProject({ message: "Project is archived; restore it to start new threads" });
  if (request.worktree !== undefined && project === null) return yield* new InvalidProject({ message: "Only threads in a project can have a worktree" });
  const agent = request.agentId === undefined ? null : yield* (yield* AgentCatalog).get(request.agentId);
  const registry = yield* ProviderRegistry;
  const providerInstanceId = request.providerInstanceId ?? agent?.provider ?? undefined;
  const instance = providerInstanceId === undefined ? yield* registry.defaultInstance : (yield* registry.get(providerInstanceId)).instance;
  if (request.model !== undefined) {
    const { adapter } = yield* registry.get(instance.id);
    yield* validateModel(adapter, vault.rootPath, request.model);
  }
  if (options.shareWorktree !== undefined && (project === null || options.shareWorktree.projectId !== project.id || request.worktree !== undefined)) {
    return yield* new InvalidProject({ message: "A thread can share a worktree of its own project only, and not make one as well" });
  }
  const id = randomUUID();
  const worktree = request.worktree === undefined || project === null ? null : yield* createWorktree(project, vault.rootPath, id, request.worktree.branch);
  if (options.shareWorktree !== undefined) yield* shareWorktree(id, options.shareWorktree);
  const thread = yield* (yield* ThreadRepository)
    .insert({
      id,
      vaultId: vault.id,
      projectId: project?.id ?? null,
      providerInstanceId: instance.id,
      agentId: agent?.id ?? null,
      model: options.model !== undefined ? options.model : request.model ?? applicableAgentModel(agent, instance),
      ...(options.childModelSource === undefined ? {} : { childModelSource: options.childModelSource }),
      title: options.title,
      draftText: options.draftText,
      continuedFrom: options.continuedFrom,
      parentThreadId: options.parentThreadId,
      createdAt: yield* (yield* WallClock).now,
    })
    .pipe(
      Effect.tapError(() => (worktree === null ? Effect.void : discardWorktree(worktree))),
      Effect.tapError(() => (options.shareWorktree === undefined ? Effect.void : unshareWorktree(id))),
    );
  yield* (yield* ThreadBus).publishThread(thread);
  const response: CreateThreadResponse = { thread };
  return response;
});
