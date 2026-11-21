import { randomUUID } from "node:crypto";
import { NodeFileSystem } from "@effect/platform-node";
import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProviderModel, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import { isSubagentActive, type RequestAnswer, type RequestPrompt, type SubagentReport } from "@wiki-agents/contracts/threads/model";
import { type Cause, Clock, Deferred, Duration, Effect, FileSystem, Option, Queue, Stream } from "effect";
import {
  type BackgroundEvent,
  type CompactInput,
  type Completion,
  type CompletionInput,
  DENIED,
  type ModelList,
  type ProviderAdapter,
  ProviderError,
  type ProviderEvent,
  type ProviderSession,
  SECRET_DENIED,
  type SessionSetup,
  type SubagentState,
  type TurnImage,
  type TurnInput,
  vaultToolsUnavailable,
} from "../port.js";
import { type AuthStatus, isSupportedVersion, notInstalled, resolveBinary, SUPPORTED_VERSION } from "./cli.js";
import { answeredInput, approvalPrompt, askedQuestions, makeTurnMapper, questionPrompt, resultFailure, resultUsage } from "./events.js";
import { appendedPrompt } from "./instructions.js";
import { decide, enforcedAutonomy } from "./permissions.js";
import { type ClaudeCodeSdk, type ClaudeQuery, type Input, type QueryParams, makeInput, type MessageImage, userMessage } from "./sdk.js";

export interface ClaudeCodeAdapterOptions {
  readonly sdk: ClaudeCodeSdk;
  /** The `claude` executable: a path, or a name looked up on `PATH`. */
  readonly binary: string;
  /** The installed Claude Code's version, read without starting a session. */
  readonly installedVersion: (binary: string) => Effect.Effect<string, ProviderError>;
  /** Whether Claude Code is signed in, read without starting a session. */
  readonly authStatus: (binary: string) => Effect.Effect<AuthStatus, ProviderError>;
  /** How long Stop waits for Claude Code to confirm the turn ended. */
  readonly stopWait?: Duration.Input;
}

/** Claude Code's own command that compacts the conversation. */
export const COMPACT_COMMAND = "/compact";

/** Why a turn ended when Claude Code exited under it. */
export const CLAUDE_STOPPED = "Claude Code stopped unexpectedly. Send a message to start it again.";

/** Told to the agent when its autonomy denies a tool. */
export const NOT_ALLOWED = "The agent's autonomy in this app doesn't allow this. Don't try it another way; say what you would have done.";

/** Where Claude Code's settings, skills, MCP servers and `CLAUDE.md` files come from: everywhere it reads them itself. */
export const SETTING_SOURCES: NonNullable<Options["settingSources"]> = ["user", "project", "local"];

/**
 * How long Claude Code waits on a call to the app's tools. Its own limit for an HTTP
 * server is five minutes without a response (2.1.322: `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`,
 * default 300000), which a call waiting for your approval, from the phone say, can pass.
 * A per-server `timeout` raises that idle limit and caps the whole call, so a call still
 * ends if nothing answers it for an hour. Upstream servers' own calls are cut after two
 * minutes by the gateway (`CALL_TIMEOUT`), apart from the approval.
 */
export const APP_TOOL_CALL_TIMEOUT_MS = 60 * 60 * 1000;

/** How long a model list is reused before Claude Code is asked again. */
const MODELS_TTL = Duration.minutes(10);

/** Sources of credentials that are billed per token (an API key); a claude.ai login is a subscription. */
const BILLED = new Set<string>(["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "user", "project", "org", "temporary"]);

/** Lines of Claude Code's stderr kept to explain a crash. */
const STDERR_LINES = 20;

/** What the Claude Code process sends, in order: read by the conversation's dispatcher. */
type Signal =
  | { readonly _tag: "message"; readonly message: SDKMessage }
  /** `agentId`: a subagent asked, not the agent. */
  | { readonly _tag: "request"; readonly requestId: string; readonly prompt: RequestPrompt; readonly agentId: string | undefined }
  /** Claude Code stopped waiting for a request (its subagent or turn was stopped). */
  | { readonly _tag: "request.cancelled"; readonly requestId: string; readonly subagentId: string | undefined }
  | { readonly _tag: "ended"; readonly reason: string | null };

/** A turn's share of the conversation, as the dispatcher routes it. `spent`: a result's cost (null when not billed). */
type TurnSignal =
  | { readonly _tag: "message"; readonly message: SDKMessage; readonly spent: number | null }
  | { readonly _tag: "request"; readonly requestId: string; readonly prompt: RequestPrompt }
  | { readonly _tag: "ended"; readonly reason: string | null };

interface RunningTurn {
  readonly id: string;
  readonly feed: Queue.Queue<TurnSignal>;
  /** Done when the turn's result arrived or the process ended. */
  readonly ended: Deferred.Deferred<void>;
}

/** One Claude Code process serving the session. It is replaced when the rules change, or when it exits. */
interface Conversation {
  readonly query: ClaudeQuery;
  readonly input: Input;
  readonly signals: Queue.Queue<Signal>;
  /** The rules it was started with. */
  readonly key: string;
  alive: boolean;
  /** The cumulative cost the last result reported. */
  cost: number;
  /** Claude Code bills this login per token (an API key), so turns report a cost. */
  billed: boolean;
  /** The vault tools it was given (name, URL and token), so a new token is sent once. */
  tools: string | undefined;
  /** The app's turns whose message was sent but which haven't begun, oldest first. */
  readonly queued: Array<RunningTurn>;
  /** The turn Claude Code runs now: the app's, or one it started by itself; null between turns. */
  current: RunningTurn | null;
  /** The current turn is one Claude Code started after Stop: it is stopped at once and not shown. */
  discarding: boolean;
  /**
   * Background work that finished and will start a turn on the agent by itself, oldest
   * first (Claude Code queues each such turn after the ones before it): a subagent's
   * report, or null for other work (a background command).
   */
  readonly wakeups: Array<SubagentReport | null>;
}

interface PendingRequest {
  readonly resolve: (result: PermissionResult) => void;
  readonly input: Record<string, unknown>;
  readonly question: boolean;
  /** The subagent that asked, once the dispatcher routed it to the subagent; undefined for the agent. */
  subagentId: string | undefined;
}

/** A subagent (Claude Code's `local_agent` task) seen in this session. */
interface Child {
  readonly state: { -readonly [K in keyof SubagentState]: SubagentState[K] };
  /** It runs in the background: its own messages aren't shown, its requests are routed to it, and its report wakes the agent. */
  backgrounded: boolean;
  /** The agent launched it, not another subagent: only then does its report wake the agent. */
  readonly topLevel: boolean;
}

/** Claude Code's flag that echoes each message it takes as its turn begins, so the adapter knows which turns are the app's. */
const REPLAY_USER_MESSAGES = "replay-user-messages";

/** The subagent a message came from; undefined for the agent's own. */
const agentOf = (message: SDKMessage): string | undefined =>
  message.type === "assistant" || message.type === "user" || message.type === "stream_event" ? (message as { readonly agent_id?: string }).agent_id : undefined;

/** The echo of a message the app sent, as its turn begins (`--replay-user-messages`). */
const isReplay = (message: SDKMessage) => message.type === "user" && (message as { readonly isReplay?: boolean }).isReplay === true;

/**
 * A message of the agent's that belongs to a turn, so one between turns begins the next.
 * Other messages (the per-turn `init`, request status, task and rate-limit updates)
 * also come between turns.
 */
const beginsTurn = (message: SDKMessage) => {
  if (message.type === "stream_event" || message.type === "assistant" || message.type === "user" || message.type === "result") return true;
  if (message.type !== "system") return false;
  if (message.subtype === "compact_boundary") return true;
  return message.subtype === "status" && (message.status === "compacting" || message.compact_result !== undefined);
};

/** A task that is a subagent: Claude Code's `local_agent` (older versions name only the subagent type). */
const isAgentTask = (task: { readonly task_type?: string; readonly subagent_type?: string }) =>
  task.task_type === "local_agent" || (task.task_type === undefined && task.subagent_type !== undefined);

const tryPromise = <A>(run: (signal: AbortSignal) => Promise<A>, message: string) =>
  Effect.tryPromise({ try: run, catch: (cause) => new ProviderError({ message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`, cause }) });

const IMAGE_TYPES: ReadonlySet<string> = new Set<MessageImage["mime"]>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** An image read into a base64 block; Claude Code takes images in the message, not by path. */
const messageImage = (fs: FileSystem.FileSystem, image: TurnImage) =>
  Effect.gen(function* () {
    if (!IMAGE_TYPES.has(image.mime)) return yield* new ProviderError({ message: `Claude Code doesn't take ${image.mime} images (${image.name}).` });
    const bytes = yield* fs.readFile(image.path).pipe(Effect.mapError((cause) => new ProviderError({ message: `Couldn't read the image ${image.name}.`, cause })));
    return { mime: image.mime as MessageImage["mime"], data: Buffer.from(bytes).toString("base64") };
  });

/**
 * Claude Code through the Claude Agent SDK, running your installed `claude` with
 * your login, settings, skills and MCP servers. Each thread is a Claude Code session
 * in the thread's working directory, with an id the app chooses, continued after a
 * restart with `resume`.
 */
export const makeClaudeCodeAdapter = (options: ClaudeCodeAdapterOptions) =>
  Effect.gen(function* () {
    const { sdk } = options;
    const stopWait = options.stopWait ?? Duration.seconds(5);
    // Claude Code runs on this machine; its paths are checked on this machine's file system.
    const fs = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }),
      NodeFileSystem.layer,
    );
    const withFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.runPromise(Effect.provideService(effect, FileSystem.FileSystem, fs));

    const executable = Effect.suspend(() => {
      const path = resolveBinary(options.binary);
      return path === undefined ? Effect.fail(new ProviderError({ message: notInstalled(options.binary) })) : Effect.succeed(path);
    });

    const status: Effect.Effect<ProviderStatus> = Effect.gen(function* () {
      const binary = yield* executable;
      const version = yield* options.installedVersion(binary);
      if (!isSupportedVersion(version)) {
        return { _tag: "unavailable", reason: `Claude Code ${version} is installed; this app supports ${SUPPORTED_VERSION.replace(/\.\d+$/, ".x")}.` } as const;
      }
      const auth = yield* options.authStatus(binary);
      if (!auth.loggedIn) return { _tag: "unavailable", reason: "Claude Code isn't signed in: run `claude` and sign in with /login." } as const;
      return { _tag: "ready", version, account: auth.account } as const;
    }).pipe(Effect.catch((error) => Effect.succeed({ _tag: "unavailable", reason: error.message } as const)));

    const modelList = (offered: Awaited<ReturnType<ClaudeQuery["supportedModels"]>>): ModelList => ({
      models: offered.map((model): ProviderModel => ({ id: model.value, name: model.displayName, free: false, images: true })),
      defaultModel: offered.some((model) => model.value === "default") ? "default" : null,
    });

    let models: { readonly at: number; readonly list: ModelList } | undefined;
    const listModels = (cwd: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (models !== undefined && now - models.at < Duration.toMillis(MODELS_TTL)) return models.list;
        const binary = yield* executable;
        const offered = yield* tryPromise(async () => {
          const input = makeInput();
          const query = sdk.query({ prompt: input.iterable, options: { cwd, pathToClaudeCodeExecutable: binary, settingSources: SETTING_SOURCES } });
          try {
            return await query.supportedModels();
          } finally {
            input.close();
            query.close();
          }
        }, "Claude Code didn't list its models");
        const list = modelList(offered);
        models = { at: now, list };
        return list;
      });

    const isolatedQuery = <A>(
      options: QueryParams["options"],
      read: (query: ClaudeQuery, input: Input) => Promise<A>,
      failure: string,
    ) => Effect.gen(function* () {
      const binary = yield* executable;
      return yield* Effect.scoped(Effect.gen(function* () {
        const { query, input } = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const input = makeInput();
              const abort = new AbortController();
              const query = sdk.query({
                prompt: input.iterable,
                options: {
                  ...options,
                  pathToClaudeCodeExecutable: binary,
                  abortController: abort,
                  tools: [],
                  skills: [],
                  settingSources: [],
                  mcpServers: {},
                  strictMcpConfig: true,
                  maxTurns: 1,
                  persistSession: false,
                },
              });
              return { query, input, abort };
            },
            catch: (cause) => new ProviderError({ message: failure, cause }),
          }),
          ({ query, input, abort }, exit) => Effect.sync(() => {
            if (exit._tag === "Failure") abort.abort();
            input.close();
            query.close();
          }),
        );
        return yield* tryPromise(() => read(query, input), failure);
      }));
    });

    const listCompletionModels = (cwd: string) =>
      isolatedQuery({ cwd }, async (query) => modelList(await query.supportedModels()), "Claude Code didn't list isolated models");

    const complete = ({ cwd, model, system, prompt }: CompletionInput) =>
      isolatedQuery(
        { cwd, ...(model === null ? {} : { model }), systemPrompt: system },
        async (query, input): Promise<Completion> => {
          input.push(userMessage(prompt));
          let billed = false;
          for await (const message of query) {
            if (message.type === "system" && message.subtype === "init") billed = BILLED.has(message.apiKeySource);
            if (message.type !== "result") continue;
            if (message.subtype !== "success" || message.is_error) throw new Error(resultFailure(message));
            return { text: message.result, usage: resultUsage(message, billed ? message.total_cost_usd : null) };
          }
          throw new Error("it ended without an answer");
        },
        "Claude Code didn't answer",
      );

    const adapter: ProviderAdapter = {
      kind: "claude-code",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true, compact: true },
      enforcement: enforcedAutonomy,
      status,
      listModels,
      listCompletionModels,
      complete,
      openSession: ({ cwd, nativeSessionId, model: initialModel }) =>
        Effect.gen(function* () {
          const binary = yield* executable;
          const realCwd = yield* fs.realPath(cwd).pipe(Effect.mapError((cause) => new ProviderError({ message: `The working folder ${cwd} isn't there.`, cause })));
          const sessionId = nativeSessionId ?? randomUUID();
          /** Claude Code has saved the session, so a new process resumes it rather than starting it. */
          let saved = nativeSessionId !== null;
          let model = initialModel;
          let conversation: Conversation | undefined;
          let latest: SessionSetup | undefined;
          const requests = new Map<string, PendingRequest>();
          const stderr: Array<string> = [];
          /** The session's scope: each process's dispatcher runs in it. */
          const sessionScope = yield* Effect.scope;
          const background = yield* Effect.acquireRelease(Queue.unbounded<BackgroundEvent>(), Queue.shutdown);
          /** The session's subagents seen in this run, by task id. */
          const children = new Map<string, Child>();
          /** Background commands the agent started (not subagents), whose end wakes it too, by task id. */
          const backgroundWork = new Set<string>();
          /** The latest turn, app's or Claude Code's; subagents launched between turns belong to it. */
          let lastTurnId: string | undefined;
          /**
           * Stop pressed (it stops everything): until you send again, a turn Claude Code
           * starts by itself is stopped at once and not shown, so the agent isn't woken.
           */
          let stopping = false;

          const tell = (event: BackgroundEvent): void => {
            Queue.offerUnsafe(background, event);
          };
          const report = (child: Child) => tell({ _tag: "subagent", state: { ...child.state } });
          const subagentsActive = () => [...children.values()].some((child) => isSubagentActive(child.state.status));

          /** Denies every request Claude Code waits on; a subagent's are closed in the thread too. */
          const cancelRequests = (message: string) => {
            for (const [id, request] of requests) {
              request.resolve({ behavior: "deny", message, interrupt: true });
              if (request.subagentId !== undefined) tell({ _tag: "request.closed", requestId: id });
            }
            requests.clear();
          };

          const close = (current: Conversation) => {
            if (!current.alive) return;
            current.alive = false;
            cancelRequests("The conversation ended.");
            current.input.close();
            current.query.close();
          };
          yield* Effect.addFinalizer(() => Effect.sync(() => conversation !== undefined && close(conversation)));

          /** Answers every tool call from the agent's autonomy, ahead of Claude Code's own permission rules. */
          const preToolUse: HookCallback = async (input) => {
            if (input.hook_event_name !== "PreToolUse" || latest === undefined) return {};
            const setup = latest;
            const decision = await withFs(
              decide({
                autonomy: setup.autonomy,
                roots: setup.projectRoots ?? [realCwd],
                readable: setup.attachmentFolders,
                protection: setup.protection,
                cwd,
                vaultTools: setup.vaultTools?.name ?? null,
                toolName: input.tool_name,
                toolInput: input.tool_input,
              }),
            );
            if (decision === "defer") return {};
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: decision === "secret" ? "deny" : decision,
                ...(decision === "deny" ? { permissionDecisionReason: NOT_ALLOWED } : decision === "secret" ? { permissionDecisionReason: SECRET_DENIED } : {}),
              },
            };
          };

          /** Closes the requests a subagent was waiting on: Claude Code no longer waits for them. */
          const closeRequestsOf = (child: Child) => {
            for (const [id, request] of [...requests]) {
              if (request.subagentId !== child.state.subagentId) continue;
              requests.delete(id);
              request.resolve({ behavior: "deny", message: "Cancelled." });
              tell({ _tag: "request.closed", requestId: id });
            }
          };

          /** Claude Code started a turn on the agent by itself (background work reported): hand it to the app as a turn of its own. */
          const startedByClaude = (current: Conversation, reports: ReadonlyArray<SubagentReport>) =>
            Effect.gen(function* () {
              const running: RunningTurn = { id: randomUUID(), feed: yield* Queue.unbounded<TurnSignal>(), ended: yield* Deferred.make<void>() };
              current.current = running;
              const setup = latest;
              if (stopping || setup === undefined) {
                // After Stop nothing may wake the agent; without a turn of this run there's nothing to run it under.
                current.discarding = true;
                yield* Effect.forkIn(
                  tryPromise(() => current.query.interrupt(), "Claude Code didn't take the stop").pipe(Effect.catch((error) => Effect.logWarning(error.message))),
                  sessionScope,
                );
                return;
              }
              lastTurnId = running.id;
              tell({ _tag: "turn", turnId: running.id, reports, events: Stream.callback<ProviderEvent, ProviderError>((out) => follow(out, current, running, false)) });
            });

          /**
           * Which turn a message of the agent's begins. Claude Code takes its inputs in
           * order, one turn each: the app's messages, echoed as their turn begins, and the
           * reports of background work, which aren't. A Claude Code that doesn't echo
           * (and the recorded fixtures made before it did) is told apart by what waits.
           */
          const begin = (current: Conversation, message: SDKMessage) =>
            Effect.gen(function* () {
              if (isReplay(message) || (current.wakeups.length === 0 && current.queued.length > 0)) {
                const next = current.queued.shift();
                if (next !== undefined) {
                  current.current = next;
                  lastTurnId = next.id;
                  return;
                }
              }
              const woke = current.wakeups.shift();
              yield* startedByClaude(current, woke === undefined || woke === null ? [] : [woke]);
            });

          const taskStarted = (current: Conversation, task: SDKTaskStartedMessage) => {
            if (!isAgentTask(task)) {
              if (task.is_backgrounded === true && task.parent_task_id === undefined && task.ambient !== true) backgroundWork.add(task.task_id);
              return;
            }
            const known = children.get(task.task_id);
            if (known !== undefined) {
              // A subagent given more work (SendMessage) runs again, in the background.
              known.backgrounded = true;
              known.state.status = "running";
              return report(known);
            }
            const parent = task.parent_task_id === undefined ? undefined : children.get(task.parent_task_id);
            const turnId = parent?.state.turnId ?? current.current?.id ?? lastTurnId;
            if (turnId === undefined) return;
            const child: Child = {
              state: { turnId, subagentId: task.task_id, label: task.description, agent: task.subagent_type ?? null, status: "running", result: null },
              backgrounded: task.is_backgrounded === true,
              topLevel: task.parent_task_id === undefined,
            };
            children.set(task.task_id, child);
            report(child);
          };

          const taskUpdated = (task: SDKTaskUpdatedMessage) => {
            if (task.patch.is_backgrounded !== true) return;
            const child = children.get(task.task_id);
            if (child !== undefined) child.backgrounded = true;
          };

          /** A task ended. A subagent's report (or a background command's end) wakes the agent, unless it was stopped. */
          const taskEnded = (current: Conversation, task: SDKTaskNotificationMessage) => {
            const child = children.get(task.task_id);
            if (child === undefined) {
              if (backgroundWork.delete(task.task_id) && task.status !== "stopped" && !stopping) current.wakeups.push(null);
              return;
            }
            child.state.status = task.status === "completed" ? "done" : task.status === "failed" ? "failed" : "cancelled";
            if (task.status !== "stopped") child.state.result = task.summary;
            closeRequestsOf(child);
            report(child);
            if (child.backgrounded && child.topLevel && task.status !== "stopped" && !stopping) {
              current.wakeups.push({ subagentId: child.state.subagentId, label: child.state.label, status: child.state.status });
            }
          };

          const onMessage = (current: Conversation, message: SDKMessage) =>
            Effect.gen(function* () {
              if (message.type === "system") {
                switch (message.subtype) {
                  case "init":
                    current.billed = BILLED.has(message.apiKeySource);
                    return;
                  case "task_started":
                    return taskStarted(current, message);
                  case "task_updated":
                    return taskUpdated(message);
                  case "task_notification":
                    return taskEnded(current, message);
                }
              }
              const from = agentOf(message);
              if (from !== undefined) {
                // A background subagent's own work isn't shown; a foreground one's is part of the turn it blocks.
                if (children.get(from)?.backgrounded === true) return;
                if (current.current !== null && !current.discarding) yield* Queue.offer(current.current.feed, { _tag: "message", message, spent: null });
                return;
              }
              if (current.current === null) {
                if (!beginsTurn(message)) return;
                yield* begin(current, message);
              }
              const running = current.current;
              if (running === null || isReplay(message)) return;
              let spent: number | null = null;
              if (message.type === "result") {
                saved = true;
                spent = current.billed ? Math.max(0, message.total_cost_usd - current.cost) : null;
                current.cost = message.total_cost_usd;
                current.current = null;
              }
              if (!current.discarding) yield* Queue.offer(running.feed, { _tag: "message", message, spent });
              if (message.type === "result") current.discarding = false;
            });

          /** A request: the agent's goes to the turn it asked in; a background subagent's to the thread, as the subagent's. */
          const onRequest = (current: Conversation, signal: Extract<Signal, { readonly _tag: "request" }>) =>
            Effect.gen(function* () {
              const request = requests.get(signal.requestId);
              if (request === undefined) return;
              const child = signal.agentId === undefined ? undefined : children.get(signal.agentId);
              if (child?.backgrounded === true) {
                request.subagentId = child.state.subagentId;
                child.state.status = "waiting";
                report(child);
                tell({ _tag: "request.opened", turnId: child.state.turnId, subagentId: child.state.subagentId, requestId: signal.requestId, prompt: signal.prompt });
                return;
              }
              if (current.current !== null && !current.discarding) {
                yield* Queue.offer(current.current.feed, { _tag: "request", requestId: signal.requestId, prompt: signal.prompt });
                return;
              }
              requests.delete(signal.requestId);
              request.resolve({ behavior: "deny", message: "No turn is running." });
            });

          /** The process ended: its turns end, and its subagents with it (what they were doing is unknown). */
          const onEnded = (current: Conversation, reason: string | null) =>
            Effect.gen(function* () {
              close(current);
              for (const running of [...(current.current === null ? [] : [current.current]), ...current.queued]) {
                yield* Queue.offer(running.feed, { _tag: "ended", reason });
              }
              current.current = null;
              current.queued.length = 0;
              current.wakeups.length = 0;
              backgroundWork.clear();
              for (const child of children.values()) {
                if (!isSubagentActive(child.state.status)) continue;
                closeRequestsOf(child);
                child.state.status = "interrupted";
                report(child);
              }
            });

          /** Reads everything the process sends, in order, and routes it: to a turn, or to the session's background. */
          const dispatch = (current: Conversation) =>
            Effect.gen(function* () {
              while (true) {
                const signal = yield* Queue.take(current.signals);
                switch (signal._tag) {
                  case "ended":
                    return yield* onEnded(current, signal.reason);
                  case "request":
                    yield* onRequest(current, signal);
                    continue;
                  case "request.cancelled":
                    if (signal.subagentId !== undefined) {
                      tell({ _tag: "request.closed", requestId: signal.requestId });
                      const child = children.get(signal.subagentId);
                      if (child?.state.status === "waiting" && ![...requests.values()].some((request) => request.subagentId === signal.subagentId)) {
                        child.state.status = "running";
                        report(child);
                      }
                    }
                    continue;
                  case "message":
                    yield* onMessage(current, signal.message);
                }
              }
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("Claude Code: routing the conversation's messages", cause)));

          /** Work runs in the process: a turn, one waiting to begin, or background work that will report. */
          const busy = (current: Conversation) => current.current !== null || current.queued.length > 0 || current.wakeups.length > 0 || subagentsActive();

          const start = (setup: SessionSetup) =>
            Effect.gen(function* () {
              const append = appendedPrompt(setup.instructions, cwd);
              const key = append ?? "";
              // New rules need a new process, which would end the work in this one: they wait until it is done.
              if (conversation?.alive === true && (conversation.key === key || busy(conversation))) return conversation;
              if (conversation !== undefined) close(conversation);
              const signals = yield* Queue.unbounded<Signal>();
              const input = makeInput();
              const resume = saved || (yield* tryPromise(() => sdk.sessionExists(sessionId, cwd), "Couldn't look for the Claude Code session"));

              /** An approval or question for the user; Claude Code waits for the answer. The dispatcher routes it. */
              const canUseTool: CanUseTool = async (toolName, toolInput, context) => {
                const questions = toolName === "AskUserQuestion" ? askedQuestions(toolInput) : [];
                const prompt =
                  questions.length > 0
                    ? questionPrompt(questions)
                    : await withFs(approvalPrompt(toolName, toolInput, cwd, { blockedPath: context.blockedPath, decisionReason: context.decisionReason }));
                const requestId = randomUUID();
                return new Promise<PermissionResult>((resolve) => {
                  const request: PendingRequest = { resolve, input: toolInput, question: questions.length > 0, subagentId: undefined };
                  requests.set(requestId, request);
                  context.signal.addEventListener(
                    "abort",
                    () => {
                      if (!requests.delete(requestId)) return;
                      resolve({ behavior: "deny", message: "Cancelled." });
                      Queue.offerUnsafe(signals, { _tag: "request.cancelled", requestId, subagentId: request.subagentId });
                    },
                    { once: true },
                  );
                  Queue.offerUnsafe(signals, { _tag: "request", requestId, prompt, agentId: context.agentID });
                });
              };

              const query = sdk.query({
                prompt: input.iterable,
                options: {
                  cwd,
                  pathToClaudeCodeExecutable: binary,
                  ...(resume ? { resume: sessionId } : { sessionId }),
                  ...(model === null ? {} : { model }),
                  // Rules apply from the next turn, so a resumed session mustn't keep the prompt it was started with.
                  systemPrompt: { type: "preset", preset: "claude_code", ...(append === null ? {} : { append }), snapshot: false },
                  settingSources: SETTING_SOURCES,
                  permissionMode: "default",
                  includePartialMessages: true,
                  // Each message the app sends is echoed as its turn begins, telling it from a turn Claude Code starts itself.
                  // Without `perTaskStopAffordance`, an interrupt stops background subagents too (Stop stops everything).
                  extraArgs: { [REPLAY_USER_MESSAGES]: null },
                  additionalDirectories: (setup.projectRoots ?? []).filter((root) => root !== realCwd),
                  hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
                  canUseTool,
                  stderr: (data) => {
                    stderr.push(...data.split("\n").filter((line) => line.trim() !== ""));
                    stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
                  },
                },
              });
              const current: Conversation = {
                query,
                input,
                signals,
                key,
                alive: true,
                cost: 0,
                billed: false,
                tools: undefined,
                queued: [],
                current: null,
                discarding: false,
                wakeups: [],
              };
              yield* Effect.forkIn(dispatch(current), sessionScope);
              void (async () => {
                try {
                  for await (const message of query) Queue.offerUnsafe(signals, { _tag: "message", message });
                  Queue.offerUnsafe(signals, { _tag: "ended", reason: null });
                } catch (error) {
                  Queue.offerUnsafe(signals, { _tag: "ended", reason: error instanceof Error ? error.message : String(error) });
                }
              })();
              conversation = current;
              return current;
            });

          /**
           * Gives the conversation the thread's vault tools, or a renewed token, through
           * the control channel (never the command line, where other users could read the
           * token). A failure leaves the turn to run without them; it returns why.
           */
          const applyTools = (current: Conversation, setup: SessionSetup) =>
            Effect.gen(function* () {
              const tools = setup.vaultTools;
              if (tools === null) return [];
              const key = JSON.stringify([tools.name, tools.url, tools.token, tools.revision]);
              if (current.tools === key) return [];
              const result = yield* tryPromise(
                () =>
                  current.query.setMcpServers({
                    [tools.name]: { type: "http", url: tools.url, headers: { Authorization: `Bearer ${tools.token}` }, timeout: APP_TOOL_CALL_TIMEOUT_MS },
                  }),
                "Claude Code didn't take the vault tools",
              ).pipe(Effect.result);
              const raw = result._tag === "Failure" ? result.failure.message : result.success.errors[tools.name];
              if (raw === undefined) {
                current.tools = key;
                return [];
              }
              current.tools = undefined;
              const reason = raw.replaceAll(tools.token, "[redacted]");
              yield* Effect.logWarning(`thread vault tools (${tools.name}) not connected in Claude Code: ${reason}`);
              return [vaultToolsUnavailable(reason)];
            });

          /**
           * Maps one turn's messages, as the dispatcher routes them to `running`, until
           * its result or the process ending.
           */
          const follow = (out: Queue.Queue<ProviderEvent, ProviderError | Cause.Done>, current: Conversation, running: RunningTurn, compacting: boolean) =>
            Effect.gen(function* () {
              const turnId = running.id;
              let spent: number | null = null;
              const mapper = makeTurnMapper(turnId, cwd, () => spent, { compacting });
              const end = (events: ReadonlyArray<ProviderEvent>) =>
                Effect.gen(function* () {
                  yield* Queue.offerAll(out, events);
                  yield* Queue.end(out);
                  yield* Deferred.succeed(running.ended, undefined);
                });

              while (true) {
                const signal = yield* Queue.take(running.feed);
                if (signal._tag === "ended") {
                  const detail = signal.reason ?? stderr.at(-1);
                  return yield* end([
                    { _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: detail === undefined ? CLAUDE_STOPPED : `${CLAUDE_STOPPED} (${detail})` },
                  ]);
                }
                if (signal._tag === "request") {
                  yield* Queue.offer(out, { _tag: "request.opened", turnId, requestId: signal.requestId, prompt: signal.prompt });
                  continue;
                }
                const message = signal.message;
                spent = signal.spent;
                const events = mapper.map(message);
                if (message.type === "result") {
                  const getContextUsage = current.query.getContextUsage?.bind(current.query);
                  if (getContextUsage === undefined || message.subtype !== "success" || message.is_error) return yield* end(events);
                  // The estimate only labels the turn's usage, so it waits at most a second and is dropped if the CLI is slow.
                  const estimate = yield* tryPromise(() => getContextUsage({ detail: "summary" }), "Couldn't read Claude Code context").pipe(
                    Effect.option,
                    Effect.timeoutOrElse({ duration: Duration.seconds(1), orElse: () => Effect.succeed(Option.none()) }),
                  );
                  if (Option.isNone(estimate)) return yield* end(events);
                  const { totalTokens, rawMaxTokens } = estimate.value;
                  if (!Number.isFinite(totalTokens) || totalTokens < 0 || !Number.isFinite(rawMaxTokens) || rawMaxTokens <= 0) return yield* end(events);
                  return yield* end(events.map((event): ProviderEvent =>
                    event._tag === "turn.finished" && event.usage !== null
                      ? { ...event, usage: { ...event.usage, context: { _tag: "compaction_window_estimate", usedTokens: totalTokens, windowTokens: rawMaxTokens } } }
                      : event,
                  ));
                }
                yield* Queue.offerAll(out, events);
              }
            });

          /**
           * Runs one exchange with Claude Code as the turn: `message` is what the user
           * sends (given the notices for this turn), and the conversation's messages are
           * mapped until its result.
           */
          const execute = (
            turnId: string,
            setup: SessionSetup,
            message: (notices: ReadonlyArray<string>) => Effect.Effect<SDKUserMessage, ProviderError>,
            compacting: boolean,
          ) =>
            Stream.callback<ProviderEvent, ProviderError>((out) =>
              Effect.gen(function* () {
                latest = setup;
                const current = yield* start(setup);
                const notices = yield* applyTools(current, setup);
                yield* Queue.offerAll(out, notices.map((notice): ProviderEvent => ({ _tag: "notice", turnId, text: notice })));
                const sent = yield* message(notices);
                const running: RunningTurn = { id: turnId, feed: yield* Queue.unbounded<TurnSignal>(), ended: yield* Deferred.make<void>() };
                // Together, so a Stop either finds the turn or comes before its message was sent.
                yield* Effect.sync(() => {
                  // You sent again after a Stop: the agent may be woken by its background work again.
                  stopping = false;
                  current.queued.push(running);
                  current.input.push(sent);
                });
                yield* follow(out, current, running, compacting);
              }),
            );

          const startTurn = ({ turnId, text, images, setup }: TurnInput) =>
            execute(
              turnId,
              setup,
              (notices) =>
                Effect.map(Effect.forEach(images, (image) => messageImage(fs, image)), (blocks) =>
                  userMessage(notices.length === 0 ? text : `${text}\n\nApp notices for this turn:\n${notices.join("\n")}`, blocks),
                ),
              false,
            );

          /**
           * Claude Code's own `/compact` command, sent as the message. Notices aren't added
           * to it: text after the command would become instructions for the summary.
           */
          const compact = ({ turnId, setup }: CompactInput) => execute(turnId, setup, () => Effect.succeed(userMessage(COMPACT_COMMAND)), true);

          /**
           * Stop stops everything. Claude Code's interrupt stops the turn and, since the
           * app doesn't declare `perTaskStopAffordance`, every background subagent with it,
           * whose stopped reports don't wake the agent (checked on 2.1.325, 2026-11-21).
           * Reports that came in before are dropped, and a turn Claude Code starts for
           * one anyway is stopped at once, until you send again.
           */
          const stopEverything = (current: Conversation) =>
            Effect.gen(function* () {
              stopping = true;
              current.wakeups.length = 0;
              cancelRequests("The user stopped the turn.");
              yield* tryPromise(() => current.query.interrupt(), "Claude Code didn't take the stop").pipe(Effect.catch((error) => Effect.logWarning(error.message)));
            });

          /**
           * Stops the turn and the subagents: pending approvals are cancelled, Claude Code
           * is asked to stop, and the turn's result awaited. A process that doesn't confirm
           * in time is closed; the next turn resumes the session in a new one.
           */
          const interrupt = (turnId: string) =>
            Effect.gen(function* () {
              const current = conversation;
              if (current === undefined || !current.alive) return;
              const running = current.current?.id === turnId ? current.current : current.queued.find((queued) => queued.id === turnId);
              if (running === undefined) {
                if (subagentsActive() || current.wakeups.length > 0) yield* stopEverything(current);
                return;
              }
              yield* stopEverything(current);
              const ended = yield* Deferred.await(running.ended).pipe(Effect.timeoutOption(stopWait));
              if (Option.isNone(ended)) {
                yield* Effect.logWarning("Claude Code didn't confirm the stop; closing it");
                if (conversation === current) close(current);
              }
            });

          /** Stop with no turn running: every subagent, and a turn their reports may start. */
          const stopBackground = Effect.gen(function* () {
            const current = conversation;
            if (current === undefined || !current.alive) return;
            yield* stopEverything(current);
          });

          const answerRequest = (requestId: string, answer: RequestAnswer) =>
            Effect.gen(function* () {
              const request = requests.get(requestId);
              if (request === undefined) return yield* new ProviderError({ message: "Claude Code is no longer waiting for this answer." });
              requests.delete(requestId);
              const child = request.subagentId === undefined ? undefined : children.get(request.subagentId);
              if (child?.state.status === "waiting" && ![...requests.values()].some((other) => other.subagentId === request.subagentId)) {
                child.state.status = "running";
                report(child);
              }
              if (request.question) {
                request.resolve(
                  answer._tag === "question"
                    ? { behavior: "allow", updatedInput: answeredInput(request.input, answer.text) }
                    : { behavior: "deny", message: DENIED },
                );
                return;
              }
              request.resolve(
                answer._tag === "approval" && answer.decision === "approve"
                  ? { behavior: "allow", updatedInput: request.input }
                  : { behavior: "deny", message: DENIED },
              );
            });

          const setModel = (next: string) =>
            Effect.gen(function* () {
              model = next;
              const current = conversation;
              if (current?.alive === true) yield* tryPromise(() => current.query.setModel(next), "Claude Code didn't switch models");
            });

          const session: ProviderSession = {
            nativeSessionId: sessionId,
            startTurn,
            compact,
            // Claude Code runs as a child of this server and stops with it, taking any
            // pending approval with it, so there is nothing to resume.
            resumeTurn: () => Effect.succeed(Option.none()),
            interrupt,
            background: Stream.fromQueue(background),
            stopBackground,
            answerRequest,
            setModel,
          };
          return session;
        }),
    };
    return adapter;
  });
