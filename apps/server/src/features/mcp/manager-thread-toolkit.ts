import { type ThreadSummary, TurnOutcome } from "@wiki-agents/contracts/threads/model";
import { Effect, Layer, Option, Schema, Semaphore, type FileSystem } from "effect";
import { McpServer, Tool, Toolkit } from "effect/ai";
import { AgentCatalog } from "../agents/catalog.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { WorktreeRoot } from "../projects/worktrees.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { listChildThreads, readChildThread, sendToChildThread, startChildThread } from "../threads/manager-threads.js";
import { ThreadActors } from "../threads/thread-actors.js";
import type { ThreadBus } from "../threads/thread-bus.js";
import { ThreadRepository } from "../threads/repository.js";
import type { VaultRepository } from "../vaults/repository.js";
import { VaultCaller } from "./auth.js";
import { ToolFailure, vaultTool } from "./tools/shared.js";

const Text = Schema.Trim.check(Schema.isNonEmpty());
const ChildId = Schema.Struct({ threadId: Text });
const Started = Schema.Struct({ threadId: Schema.String, turnId: Schema.String });
const common = { failure: ToolFailure, dependencies: [VaultCaller] };

const ManagerTools = Toolkit.make(
  vaultTool(Tool.make("thread_create", {
    ...common,
    description: "Start a child app thread in this project's workspace. Choose an agent or inherit this thread's agent.",
    parameters: Schema.Struct({
      title: Text.check(Schema.isMaxLength(80)),
      prompt: Text.check(Schema.isMaxLength(4000)),
      agentId: Schema.optionalKey(Text),
      providerInstanceId: Schema.optionalKey(Text),
      model: Schema.optionalKey(Text),
    }),
    success: Started,
  })).annotate(Tool.Readonly, false),
  vaultTool(Tool.make("thread_list", {
    ...common,
    description: "List the child app threads you started and see what they are doing.",
    success: Schema.Struct({ children: Schema.Array(Schema.Struct({
      threadId: Schema.String,
      title: Schema.NullOr(Schema.String),
      status: Schema.Literals(["working", "waiting", "done", "failed", "stopped", "idle"]),
    })) }),
  })),
  vaultTool(Tool.make("thread_read", {
    ...common,
    description: "Read the final reply and outcome of this child's latest finished turn.",
    parameters: ChildId,
    success: Schema.Struct({ reply: Schema.NullOr(Schema.String), outcome: Schema.NullOr(TurnOutcome) }),
  })),
  vaultTool(Tool.make("thread_send", {
    ...common,
    description: "Send a follow-up prompt to one of your idle child threads.",
    parameters: Schema.Struct({ ...ChildId.fields, prompt: Text.check(Schema.isMaxLength(4000)) }),
    success: Started,
  })).annotate(Tool.Readonly, false),
);

const managerThread = Effect.gen(function* () {
  const caller = yield* VaultCaller;
  const thread = Option.getOrUndefined(yield* (yield* ThreadRepository).find(caller.threadId));
  if (thread === undefined || thread.vaultId !== caller.vaultId || thread.parentThreadId != null || thread.agentId === null) return undefined;
  const agent = yield* (yield* AgentCatalog).get(thread.agentId).pipe(Effect.option);
  const permission = Option.getOrUndefined(agent)?.autonomy.threads;
  return permission === "ask" || permission === "allow" ? thread : undefined;
});

const requireManager = managerThread.pipe(Effect.flatMap((thread) =>
  thread === undefined ? Effect.fail(new ToolFailure({ message: "Child thread tools are unavailable for this thread." })) : Effect.succeed(thread),
));

const ManagerVisibility = McpServer.visibility(Effect.gen(function* () {
  const services = yield* Effect.context<ThreadRepository | AgentCatalog>();
  return () => managerThread.pipe(
    Effect.provideContext(services),
    Effect.map((thread) => thread !== undefined),
    Effect.orElseSucceed(() => false),
  );
}));

type Services = ThreadActors | ThreadRepository | ThreadBus | AgentCatalog | ProjectRepository | ProviderRegistry | VaultRepository | WorktreeRoot | FileSystem.FileSystem;

const managerHandlers = ManagerTools.toLayer(Effect.gen(function* () {
  const services = yield* Effect.context<Services>();
  const mutations = yield* Semaphore.make(1);
  const handle = <A, E extends { readonly _tag: string; readonly message?: string }>(work: Effect.Effect<A, E, Services | VaultCaller>) =>
    work.pipe(
      Effect.provideContext(services),
      Effect.catch((error) => Effect.fail(new ToolFailure({ message:
        error._tag === "ToolFailure" || error._tag === "DelegationRefused" || error._tag === "ToolCallRefused"
          ? error.message ?? "The call was refused."
          : error._tag === "NoTurnRunning"
            ? "Child threads can only be started or prompted during a running turn."
            : `The child thread call failed (${error._tag}). Use thread_list to check its state before retrying.`,
      }))),
    );

  const mutate = <A, E>(title: string, detail: object, work: (manager: ThreadSummary, unattended: boolean) => Effect.Effect<A, E, Services>) =>
    Effect.gen(function* () {
      const manager = yield* requireManager;
      const stop = yield* (yield* ThreadActors).approveToolCall(manager.id, {
        level: (autonomy) => autonomy.threads ?? "deny",
        prompt: { _tag: "approval", title, detail: JSON.stringify(detail, null, 2) },
      });
      return yield* Effect.raceFirst(
        Effect.gen(function* () {
          const current = yield* requireManager;
          const turn = Option.getOrUndefined((yield* (yield* ThreadRepository).recovery(current.id)).openTurn);
          if (turn === undefined) return yield* new ToolFailure({ message: "The manager's turn has ended." });
          return yield* Effect.uninterruptible(work(current, turn.unattended));
        }).pipe(mutations.withPermits(1)),
        stop.pipe(Effect.andThen(Effect.fail(new ToolFailure({ message: "The manager's turn ended. Check thread_list before retrying." })))),
      );
    });

  return ManagerTools.of({
    thread_create: (params) => handle(mutate("Start child thread", params, (manager, unattended) => startChildThread(manager, params, unattended))),
    thread_list: () => handle(Effect.gen(function* () {
      const manager = yield* requireManager;
      const children = yield* listChildThreads(manager.id);
      return { children: children.map((child) => ({
        threadId: child.id,
        title: child.title,
        status: child.status === "waiting" ? "waiting" as const
          : child.status === "running" || child.subagentsActive > 0 ? "working" as const
          : child.lastTurn?.outcome === "completed" ? "done" as const
          : child.lastTurn?.outcome === "failed" ? "failed" as const
          : child.lastTurn?.outcome === "interrupted" ? "stopped" as const
          : "idle" as const,
      })) };
    })),
    thread_read: ({ threadId }) => handle(Effect.flatMap(requireManager, (manager) => readChildThread(manager.id, threadId))),
    thread_send: (params) => handle(mutate("Send to child thread", params, (manager, unattended) => sendToChildThread(manager.id, params.threadId, params.prompt, unattended))),
  });
}));

export const ManagerThreadRegistrations = McpServer.toolkit(ManagerTools).pipe(
  Layer.provide(ManagerVisibility.layer),
  Layer.provide(managerHandlers),
);
