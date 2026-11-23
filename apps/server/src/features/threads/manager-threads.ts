import type { ProviderReadiness, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { ChildWorkerSelection, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Data, Effect, Option } from "effect";
import { threadWorktree, worktreeProblem } from "../projects/worktrees.js";
import { AgentCatalog } from "../agents/catalog.js";
import type { AgentDefinition } from "../agents/definition.js";
import { ProviderRegistry } from "../providers/registry.js";
import { applicableAgentModel, validateModel } from "./model-selection.js";
import { threadWorkspace } from "./workspace.js";
import { createThread } from "./create-thread/use-case.js";
import { finalReply } from "./final-reply.js";
import { findThread } from "./find-thread.js";
import { ThreadRepository } from "./repository.js";
import { ThreadActors } from "./thread-actors.js";

const ACTIVE_CHILD_LIMIT = 4;

export class DelegationRefused extends Data.TaggedError("DelegationRefused")<{ readonly message: string }> {}

const checkCapacity = Effect.fnUntraced(function* (managerId: string) {
  const children = yield* (yield* ThreadRepository).listChildren(managerId);
  if (children.filter((child) => child.status !== "idle" || child.subagentsActive > 0).length >= ACTIVE_CHILD_LIMIT) {
    return yield* new DelegationRefused({ message: "Four child threads are already active. Wait for one to finish." });
  }
});

const ownedChild = Effect.fnUntraced(function* (managerId: string, childId: string) {
  const child = yield* (yield* ThreadRepository).find(childId);
  if (Option.isNone(child) || child.value.parentThreadId !== managerId) {
    return yield* new DelegationRefused({ message: "That thread is not one of this manager's children." });
  }
  return child.value;
});

interface WorkerOverrides {
  readonly agentId?: string;
  readonly providerInstanceId?: string;
  readonly model?: string;
}

const permitsWorker = (manager: AgentDefinition, agentId: string) =>
  manager.id === agentId || manager.workers === null || manager.workers.includes(agentId);

const readinessOf = (status: ProviderStatus): ProviderReadiness =>
  status._tag === "unavailable" ? status : { _tag: "ready" };

const unconfiguredProvider = (id: string): ProviderReadiness => ({
  _tag: "unavailable",
  reason: `Provider "${id}" is no longer configured. Choose a provider instance explicitly.`,
});

export const discoverWorkers = Effect.fnUntraced(function* (manager: ThreadSummary) {
  const catalog = yield* AgentCatalog;
  const agent = yield* catalog.get(manager.agentId ?? "");
  const { agents } = yield* catalog.current;
  const registry = yield* ProviderRegistry;
  const providers = yield* registry.list;
  const listed = yield* Effect.forEach(providers, (instance) =>
    registry.get(instance.id).pipe(
      Effect.flatMap(({ adapter }) => Effect.map(adapter.status, readinessOf)),
      Effect.catchTag("ProviderInstanceNotFound", () => Effect.succeed(unconfiguredProvider(instance.id))),
      Effect.map((status) => ({ instance, status })),
    ), { concurrency: 4 });
  const instances = new Map(listed.map((entry) => [entry.instance.id, entry]));
  return {
    workers: agents.filter((worker) => permitsWorker(agent, worker.id)).map((worker) => {
      const providerInstanceId = manager.providerInstanceId;
      const entry = instances.get(providerInstanceId);
      return {
        agentId: worker.id,
        name: worker.name,
        description: worker.description,
        providerInstanceId,
        providerConfigured: entry !== undefined,
        status: entry?.status ?? unconfiguredProvider(providerInstanceId),
        model: manager.model,
      };
    }),
    providers: listed.map(({ instance: { id, name, capabilities }, status }) => ({
      providerInstanceId: id, name, supportsModels: capabilities.models, status,
    })),
  };
});

const resolveProvider = Effect.fnUntraced(function* (manager: ThreadSummary, input: WorkerOverrides) {
  const catalog = yield* AgentCatalog;
  const managerAgent = yield* catalog.get(manager.agentId ?? "");
  const agentId = input.agentId ?? managerAgent.id;
  if (!permitsWorker(managerAgent, agentId)) {
    return yield* new DelegationRefused({ message: 'Agent "' + agentId + '" is outside this manager’s worker allowlist. Use thread_workers or ask the user to update the allowlist.' });
  }
  const agent = agentId === managerAgent.id ? managerAgent : yield* catalog.get(agentId);
  const registry = yield* ProviderRegistry;
  const providerId = input.providerInstanceId ?? manager.providerInstanceId;
  const { instance, adapter } = yield* registry.get(providerId);
  const agentDefault = applicableAgentModel(agent, instance);
  return { agent, instance, adapter, agentDefault };
});

export const discoverWorkerModels = Effect.fnUntraced(function* (manager: ThreadSummary, input: WorkerOverrides) {
  const { agent, instance, adapter, agentDefault } = yield* resolveProvider(manager, input);
  const status = readinessOf(yield* adapter.status);
  const offered = status._tag === "ready" && instance.capabilities.models
    ? yield* Effect.flatMap(threadWorkspace(manager), ({ cwd }) => adapter.listModels(cwd))
    : { models: [], defaultModel: null };
  return { agentId: agent.id, providerInstanceId: instance.id, status, agentDefault, ...offered };
});

export const resolveChildWorker = Effect.fnUntraced(function* (manager: ThreadSummary, input: WorkerOverrides) {
  const { agent, instance, agentDefault } = yield* resolveProvider(manager, input);
  const inheritsModel = instance.id === manager.providerInstanceId;
  const defaultModel = inheritsModel ? manager.model : agentDefault;
  return {
    agentId: agent.id,
    providerInstanceId: instance.id,
    model: input.model ?? defaultModel,
    modelSource: input.model !== undefined ? "explicit" : defaultModel === null ? "provider-default" : inheritsModel ? "inherited" : "agent-default",
  } as const satisfies ChildWorkerSelection;
});

const providerUnavailable = (id: string, reason: string) => new DelegationRefused({
  message: `Provider "${id}" is unavailable. ${reason} Use thread_workers to choose another instance.`,
});

export const validateChildWorker = Effect.fnUntraced(function* (manager: ThreadSummary, worker: ChildWorkerSelection) {
  const { adapter } = yield* (yield* ProviderRegistry).get(worker.providerInstanceId);
  const status = yield* adapter.status;
  if (status._tag === "unavailable") return yield* providerUnavailable(worker.providerInstanceId, status.reason);
  if (worker.modelSource !== "explicit" || worker.model === null) return;
  const { cwd } = yield* threadWorkspace(manager);
  yield* validateModel(adapter, cwd, worker.model);
});

export const childWorkerSelection = (thread: ThreadSummary): ChildWorkerSelection => ({
  agentId: thread.agentId,
  providerInstanceId: thread.providerInstanceId,
  model: thread.model,
  modelSource: thread.childModelSource ?? (thread.model === null ? "provider-default" : "unknown"),
});

export const startChildThread = Effect.fnUntraced(function* (
  manager: ThreadSummary,
  input: { readonly title: string; readonly prompt: string; readonly agentId?: string; readonly providerInstanceId?: string; readonly model?: string },
  unattended: boolean,
  approved: ChildWorkerSelection,
) {
  const worker = yield* resolveChildWorker(manager, input);
  if (worker.agentId !== approved.agentId || worker.providerInstanceId !== approved.providerInstanceId ||
      worker.model !== approved.model || worker.modelSource !== approved.modelSource) {
    return yield* new DelegationRefused({ message: "The worker selection changed while this launch was pending. Check thread_workers or thread_worker_models and request launch again." });
  }
  yield* checkCapacity(manager.id);
  const shareWorktree = manager.projectId === null ? undefined : Option.getOrUndefined(yield* threadWorktree(manager.id));
  if (shareWorktree !== undefined && (yield* worktreeProblem(manager.id)) !== null) {
    return yield* new DelegationRefused({ message: "The manager's worktree is unavailable." });
  }
  const { thread } = yield* createThread({
    vaultId: manager.vaultId,
    ...(manager.projectId === null ? {} : { projectId: manager.projectId }),
    agentId: worker.agentId,
    providerInstanceId: worker.providerInstanceId,
  }, {
    model: worker.model,
    childModelSource: worker.modelSource,
    title: input.title,
    parentThreadId: manager.id,
    ...(shareWorktree === undefined ? {} : { shareWorktree }),
  });
  const { turnId, dispatched } = yield* (yield* ThreadActors).queueChildMessage(thread.id, input.prompt, unattended);
  return { result: { threadId: thread.id, turnId, ...childWorkerSelection(thread) }, dispatched };
});

export const listChildThreads = Effect.fnUntraced(function* (managerId: string) {
  return yield* (yield* ThreadRepository).listChildren(managerId);
});

export const readChildThread = Effect.fnUntraced(function* (managerId: string, childId: string) {
  yield* ownedChild(managerId, childId);
  const events = (yield* (yield* ThreadRepository).events(childId, 0)).map(({ event }) => event);
  const last = events.findLast((event) => event._tag === "turn.finished");
  return { reply: last === undefined ? null : finalReply(events, last.turnId), outcome: last?.outcome ?? null };
});

export const sendToChildThread = Effect.fnUntraced(function* (managerId: string, childId: string, prompt: string, unattended: boolean) {
  const child = yield* ownedChild(managerId, childId);
  if (child.status !== "idle" || child.subagentsActive > 0) {
    return yield* new DelegationRefused({ message: "This child is still active. Wait for it to finish." });
  }
  yield* checkCapacity(managerId);
  const { turnId, dispatched } = yield* (yield* ThreadActors).queueChildMessage(child.id, prompt, unattended);
  return { result: { threadId: child.id, turnId }, dispatched };
});
