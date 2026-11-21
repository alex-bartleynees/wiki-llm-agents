import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { NodeFileSystem } from "@effect/platform-node";
import type { ProviderModel, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer, RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Clock, Deferred, Duration, Effect, FileSystem, Option, Queue, Stream } from "effect";
import { resolveBinary } from "../binary.js";
import {
  type BackgroundEvent,
  type CompactInput,
  DENIED,
  type ModelList,
  type ProviderAdapter,
  ProviderError,
  type ProviderEvent,
  type ProviderSession,
  type SessionSetup,
  type SubagentState,
  type TurnImage,
  type TurnInput,
  vaultToolsUnavailable,
} from "../port.js";
import { type CodexLauncher, type Incoming, initialize, makeRpc, RpcError, type RpcClient } from "./app-server.js";
import { type AuthStatus, describeError, isSupportedVersion, notInstalled, SUPPORTED_VERSION, withAppServer } from "./cli.js";
import {
  commandPrompt,
  elicitationPrompt,
  fileChangePrompt,
  isConfirmation,
  makeTurnMapper,
  permissionsPrompt,
  questionPrompt,
  VAULT_SERVER,
} from "./events.js";
import { developerInstructions, findGitRoot } from "./instructions.js";
import { APPROVAL_POLICY, autonomyConfig, decideCommand, decideFileChange, enforcedAutonomy, existingProtection, permissionsReachProtected, SANDBOX } from "./permissions.js";
import { isUnprotected } from "../../../shared/secret-paths.js";
import type {
  CommandApprovalParams,
  ElicitationParams,
  FileChangeApprovalParams,
  JsonRpcId,
  Model,
  ModelListResponse,
  Notifications,
  PermissionsApprovalParams,
  ThreadItem,
  ThreadParams,
  ThreadResponse,
  TurnStartResponse,
  UserInput,
  UserInputParams,
} from "./protocol.js";

export interface CodexAdapterOptions {
  readonly launcher: CodexLauncher;
  /** The `codex` executable: a path, or a name looked up on `PATH`. */
  readonly binary: string;
  /** The installed Codex's version, read without starting a session. */
  readonly installedVersion: (binary: string) => Effect.Effect<string, ProviderError>;
  /** Whether Codex is signed in, read without starting a session. */
  readonly authStatus: (binary: string) => Effect.Effect<AuthStatus, ProviderError>;
  /** How long Stop waits for Codex to confirm the turn ended. */
  readonly stopWait?: Duration.Input;
}

/**
 * A message as `turn/start` input: its images, which Codex reads from disk, then its
 * text (left out when empty and there are images).
 */
export const turnInput = (text: string, images: ReadonlyArray<TurnImage>): ReadonlyArray<UserInput> => [
  ...images.map((image): UserInput => ({ type: "localImage", path: image.path })),
  ...(text === "" && images.length > 0 ? [] : [{ type: "text" as const, text, text_elements: [] }]),
];

/** Whether a listed model takes images; a Codex that doesn't report input modalities is taken to. */
export const takesImages = (model: Pick<Model, "inputModalities">) => model.inputModalities?.includes("image") ?? true;

/** Why a turn ended when Codex exited under it. */
export const CODEX_STOPPED = "Codex stopped unexpectedly. Send a message to start it again.";

/** Shown for a step the agent's autonomy declined. */
export const NOT_ALLOWED = "The agent's autonomy in this app doesn't allow this.";

/**
 * The environment variable holding the thread's vault tools token. Codex reads it
 * (`bearer_token_env_var`); the token is never on a command line or in Codex's config.
 */
export const TOKEN_ENV = "WIKI_AGENTS_VAULT_TOKEN";

/** How long a model list is reused before Codex is asked again. */
const MODELS_TTL = Duration.minutes(10);

type Signal =
  | Incoming
  | { readonly _tag: "started"; readonly codexTurnId: string }
  | { readonly _tag: "startFailed"; readonly reason: string }
  | { readonly _tag: "ended"; readonly reason: string | null };

/** One `codex app-server` serving the thread. It is replaced when the rules or the vault token change, or when it exits. */
interface Conversation {
  readonly rpc: RpcClient;
  readonly signals: Queue.Queue<Signal>;
  readonly children: Map<string, CodexChild>;
  stopping: boolean;
  /** The setup it was started with. */
  readonly key: string;
  alive: boolean;
  /** The vault tools failed to start, and the user was told. */
  toolsReported: boolean;
}

interface CodexChild {
  state: SubagentState;
  nativeTurnId: string | undefined;
  result: string | null;
  readonly mapper: ReturnType<typeof makeTurnMapper>;
  stopped: Deferred.Deferred<void>;
  readonly requests: Set<string>;
}

type PendingRequest =
  | { readonly kind: "command" | "fileChange"; readonly id: JsonRpcId; readonly itemId: string }
  | { readonly kind: "permissions"; readonly id: JsonRpcId; readonly params: PermissionsApprovalParams }
  | { readonly kind: "userInput"; readonly id: JsonRpcId; readonly params: UserInputParams }
  | { readonly kind: "elicitation"; readonly id: JsonRpcId };

interface RunningTurn {
  readonly id: string;
  /** Codex's id for the turn, once it says. */
  codexTurnId: string | undefined;
  /** Stop was pressed before Codex said the turn's id. */
  stopping: boolean;
  /** Done when the turn's result arrived or the process ended. */
  readonly ended: Deferred.Deferred<void>;
}

const tryPromise = <A>(run: () => Promise<A>, message: string) =>
  Effect.tryPromise({ try: run, catch: (cause) => new ProviderError({ message: `${message}: ${describeError(cause)}`, cause }) });

/** What answers each kind of request when nobody will: a stopped turn, a closed session. */
const cancelled = (request: PendingRequest): unknown => {
  switch (request.kind) {
    case "command":
    case "fileChange":
      return { decision: "cancel" };
    case "permissions":
      return { permissions: {}, scope: "turn" };
    case "userInput":
      return { answers: {} };
    case "elicitation":
      return { action: "cancel", content: null, _meta: null };
  }
};

/** Codex's grant: what it asked for, without the parts it left empty. */
const granted = (params: PermissionsApprovalParams) =>
  Object.fromEntries(Object.entries(params.permissions).filter(([, value]) => value !== null && value !== undefined));

const answered = (request: PendingRequest, answer: RequestAnswer): unknown => {
  const approved = answer._tag === "approval" && answer.decision === "approve";
  switch (request.kind) {
    case "command":
    case "fileChange":
      return { decision: approved ? "accept" : "decline" };
    case "permissions":
      return { permissions: approved ? granted(request.params) : {}, scope: "turn" };
    case "userInput":
      return {
        answers: answer._tag === "question" ? Object.fromEntries(request.params.questions.map((question) => [question.id, { answers: [answer.text] }])) : {},
      };
    case "elicitation":
      return approved ? { action: "accept", content: {}, _meta: null } : { action: "decline", content: null, _meta: null };
  }
};

/**
 * Codex through `codex app-server` (JSON-RPC over stdio, as Codex's IDE extension
 * uses it), running your installed `codex` with your login, `~/.codex/config.toml`,
 * skills and MCP servers. Each thread is a Codex thread in the thread's working
 * directory, served by an app-server of its own while the thread is open, and
 * continued after a restart with `thread/resume`.
 */
export const makeCodexAdapter = (options: CodexAdapterOptions) =>
  Effect.gen(function* () {
    const { launcher } = options;
    const stopWait = options.stopWait ?? Duration.seconds(5);
    // Codex runs on this machine; its paths are checked on this machine's file system.
    const fs = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }),
      NodeFileSystem.layer,
    );
    const withFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.provideService(effect, FileSystem.FileSystem, fs);

    const executable = Effect.suspend(() => {
      const path = resolveBinary(options.binary);
      return path === undefined ? Effect.fail(new ProviderError({ message: notInstalled(options.binary) })) : Effect.succeed(path);
    });

    const status: Effect.Effect<ProviderStatus> = Effect.gen(function* () {
      const binary = yield* executable;
      const version = yield* options.installedVersion(binary);
      if (!isSupportedVersion(version)) {
        return { _tag: "unavailable", reason: `Codex ${version} is installed; this app supports ${SUPPORTED_VERSION} or later 0.x releases.` } as const;
      }
      const auth = yield* options.authStatus(binary);
      if (!auth.loggedIn) return { _tag: "unavailable", reason: "Codex isn't signed in: run `codex login`." } as const;
      return { _tag: "ready", version, account: auth.account } as const;
    }).pipe(Effect.catch((error) => Effect.succeed({ _tag: "unavailable", reason: error.message } as const)));

    let models: { readonly at: number; readonly list: ModelList } | undefined;
    const listModels = (cwd: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (models !== undefined && now - models.at < Duration.toMillis(MODELS_TTL)) return models.list;
        const binary = yield* executable;
        const offered = yield* withAppServer(launcher, binary, cwd, "Codex didn't list its models", async (rpc) => {
          const all = [];
          let cursor: string | null = null;
          do {
            const page: ModelListResponse = await rpc.request<ModelListResponse>("model/list", cursor === null ? {} : { cursor });
            all.push(...page.data);
            cursor = page.nextCursor;
          } while (cursor !== null);
          return all;
        });
        const visible = offered.filter((model) => !model.hidden);
        const list: ModelList = {
          models: visible.map((model): ProviderModel => ({ id: model.id, name: model.displayName, free: false, images: takesImages(model) })),
          defaultModel: visible.find((model) => model.isDefault)?.id ?? null,
        };
        models = { at: now, list };
        return list;
      });

    const adapter: ProviderAdapter = {
      kind: "codex",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true, compact: true },
      enforcement: enforcedAutonomy,
      status,
      listModels,
      openSession: ({ cwd, nativeSessionId, model: initialModel, setup: initialSetup }) =>
        Effect.gen(function* () {
          const binary = yield* executable;
          const realCwd = yield* fs.realPath(cwd).pipe(Effect.mapError((cause) => new ProviderError({ message: `The working folder ${cwd} isn't there.`, cause })));
          const gitRoot = findGitRoot(realCwd, existsSync);
          let threadId = nativeSessionId;
          let model = initialModel;
          let conversation: Conversation | undefined;
          let turn: RunningTurn | undefined;
          const sessionScope = yield* Effect.scope;
          const background = yield* Queue.unbounded<BackgroundEvent>();
          const requests = new Map<string, PendingRequest>();
          /** Why Codex didn't run an item (autonomy or you declined it), by item id. */
          const declined = new Map<string, string>();
          /** Codex turns that have ended; their late notifications are ignored. */
          const ended = new Set<string>();

          const cancelRequests = (current: Conversation | undefined) => {
            if (current?.alive === true) for (const request of requests.values()) current.rpc.respond(request.id, cancelled(request));
            requests.clear();
          };

          const publishChild = (child: CodexChild, status: SubagentState["status"], result = child.state.result) => {
            child.state = { ...child.state, status, result };
            Queue.offerUnsafe(background, { _tag: "subagent", state: child.state });
          };

          const clearChildRequests = (child: CodexChild) => {
            for (const requestId of child.requests) {
              requests.delete(requestId);
              Queue.offerUnsafe(background, { _tag: "request.closed", requestId });
            }
            child.requests.clear();
          };

          const close = (current: Conversation) => {
            for (const child of current.children.values()) {
              if (child.state.status !== "running" && child.state.status !== "waiting") continue;
              clearChildRequests(child);
              publishChild(child, current.stopping ? "cancelled" : "interrupted");
              Deferred.doneUnsafe(child.stopped, Effect.void);
            }
            if (conversation === current) cancelRequests(current);
            current.alive = false;
            current.rpc.kill();
          };
          yield* Effect.addFinalizer(() => Effect.sync(() => conversation !== undefined && close(conversation)));

          /** Starts (or resumes) the thread in a new app-server unless the running one has this setup. */
          const start = (setup: SessionSetup) =>
            Effect.gen(function* () {
              const instructions = developerInstructions(setup.instructions, realCwd, gitRoot);
              const tools = setup.vaultTools;
              // Codex's sandbox gets what exists now; the app's own checks keep every protected path.
              const sandboxed = existingProtection(setup.protection, existsSync);
              const config = {
                ...autonomyConfig(setup.autonomy, sandboxed, [cwd, realCwd, ...(setup.projectRoots ?? [])]),
                ...(tools === null ? {} : { [`mcp_servers.${VAULT_SERVER}`]: { url: tools.url, bearer_token_env_var: TOKEN_ENV } }),
              };
              const key = JSON.stringify([instructions, config, tools?.token ?? null, tools?.revision ?? null]);
              if (conversation?.alive === true && conversation.key === key) return conversation;
              if (conversation !== undefined) close(conversation);
              const signals = yield* Queue.unbounded<Signal>();
              const incoming = yield* Queue.unbounded<Incoming | Extract<Signal, { _tag: "ended" }>>();
              let current: Conversation | undefined;
              const rpc = makeRpc(
                launcher.launch({ binary, cwd, env: tools === null ? {} : { [TOKEN_ENV]: tools.token } }),
                (message) => Queue.offerUnsafe(incoming, message),
                (reason) => {
                  if (current !== undefined) current.alive = false;
                  Queue.offerUnsafe(incoming, { _tag: "ended", reason });
                },
              );
              current = { rpc, signals, key, alive: true, toolsReported: false, children: new Map(), stopping: false };
              conversation = current;
              const params: ThreadParams = {
                cwd,
                ...(model === null ? {} : { model }),
                approvalPolicy: APPROVAL_POLICY,
                // The permission profile replaces the sandbox mode; sent together, the mode wins (Codex 0.167.1).
                ...(isUnprotected(sandboxed) ? { sandbox: SANDBOX } : {}),
                config,
                developerInstructions: instructions,
              };
              const opened = yield* tryPromise(async () => {
                await initialize(rpc);
                if (threadId !== null) {
                  try {
                    return await rpc.request<ThreadResponse>("thread/resume", { threadId, ...params, excludeTurns: true });
                  } catch (error) {
                    // Codex doesn't have it (a thread saves itself with its first turn): start a new one.
                    if (!(error instanceof RpcError) || !current.alive) throw error;
                  }
                }
                return await rpc.request<ThreadResponse>("thread/start", params);
              }, "Codex didn't start the thread").pipe(Effect.tapError(() => Effect.sync(() => close(current))));
              threadId = opened.thread.id;
              yield* Effect.forkIn(dispatch(current, setup, incoming, threadId), sessionScope);
              return current;
            });

          /** Answers a request Codex sends during a turn from the autonomy, or opens it for you. */
          const handleRequest = (current: Conversation, setup: SessionSetup, request: Extract<Incoming, { readonly _tag: "request" }>, child?: CodexChild): Effect.Effect<ReadonlyArray<ProviderEvent>> =>
            Effect.gen(function* () {
              const ask = (pending: PendingRequest, prompt: RequestPrompt): Effect.Effect<ReadonlyArray<ProviderEvent>> =>
                Effect.sync(() => {
                  const requestId = randomUUID();
                  if (child !== undefined) {
                    if (current.stopping) {
                      current.rpc.respond(request.id, cancelled(pending));
                      return [];
                    }
                    requests.set(requestId, pending);
                    child.requests.add(requestId);
                    publishChild(child, "waiting");
                    Queue.offerUnsafe(background, { _tag: "request.opened", turnId: child.state.turnId, subagentId: child.state.subagentId, requestId, prompt });
                    return [];
                  }
                  if (turn === undefined) {
                    current.rpc.respond(request.id, cancelled(pending));
                    return [];
                  }
                  requests.set(requestId, pending);
                  return [{ _tag: "request.opened", turnId: turn.id, requestId, prompt }];
                });
              const decide = (level: "allow" | "ask" | "deny", pending: PendingRequest, prompt: Effect.Effect<RequestPrompt>) => {
                if (level === "allow") return Effect.sync(() => (current.rpc.respond(request.id, { decision: "accept" }), []));
                if (level === "deny") {
                  return Effect.sync(() => {
                    if (pending.kind === "command" || pending.kind === "fileChange") declined.set(pending.itemId, NOT_ALLOWED);
                    current.rpc.respond(request.id, { decision: "decline" });
                    return [];
                  });
                }
                return Effect.flatMap(prompt, (shown) => ask(pending, shown));
              };
              switch (request.method) {
                case "item/commandExecution/requestApproval": {
                  const params = request.params as CommandApprovalParams;
                  return yield* decide(decideCommand(setup.autonomy, setup.protection, params.command ?? ""), { kind: "command", id: request.id, itemId: params.itemId }, Effect.sync(() => commandPrompt(params, cwd)));
                }
                case "item/fileChange/requestApproval": {
                  const params = request.params as FileChangeApprovalParams;
                  const changes = (child?.mapper ?? mapperOf(current))?.fileChange(params.itemId) ?? [];
                  const level = yield* withFs(decideFileChange({ autonomy: setup.autonomy, roots: setup.projectRoots ?? [realCwd], cwd, changes, protection: setup.protection }));
                  return yield* decide(level, { kind: "fileChange", id: request.id, itemId: params.itemId }, withFs(fileChangePrompt(changes, cwd, params.reason)));
                }
                case "item/permissions/requestApproval": {
                  const params = request.params as PermissionsApprovalParams;
                  if (permissionsReachProtected(setup.protection, params.permissions)) {
                    // Nothing granted: the access asked for would reach a file holding secrets.
                    current.rpc.respond(request.id, { permissions: {}, scope: "turn" });
                    return [];
                  }
                  return yield* ask({ kind: "permissions", id: request.id, params }, permissionsPrompt(params));
                }
                case "item/tool/requestUserInput": {
                  const params = request.params as UserInputParams;
                  return yield* ask({ kind: "userInput", id: request.id, params }, questionPrompt(params.questions));
                }
                case "mcpServer/elicitation/request": {
                  const params = request.params as ElicitationParams;
                  // Codex confirms MCP tool calls itself; the app's own server decides each of its
                  // calls (vault writes, other servers' tools), so asking here would ask twice.
                  if (params.serverName === VAULT_SERVER && isConfirmation(params)) {
                    current.rpc.respond(request.id, { action: "accept", content: {}, _meta: null });
                    return [];
                  }
                  if (isConfirmation(params)) return yield* ask({ kind: "elicitation", id: request.id }, elicitationPrompt(params));
                  current.rpc.respond(request.id, { action: "decline", content: null, _meta: null });
                  return turn === undefined ? [] : [{ _tag: "notice", turnId: turn.id, text: `${params.serverName} asked for input the app can't show, so it was declined: ${params.message}` }];
                }
                default:
                  current.rpc.respondError(request.id, `wiki-agents doesn't handle ${request.method}`);
                  return [];
              }
            });

          /** The running turn's mapper, for the file changes a patch approval refers to. */
          let activeMapper: { readonly conversation: Conversation; readonly mapper: ReturnType<typeof makeTurnMapper> } | undefined;
          const mapperOf = (current: Conversation) => (activeMapper?.conversation === current ? activeMapper.mapper : undefined);

          /** Routes child traffic even when the app has no parent turn running. */
          const dispatch = (
            current: Conversation,
            setup: SessionSetup,
            incoming: Queue.Queue<Incoming | Extract<Signal, { _tag: "ended" }>>,
            parentId: string,
          ) => Effect.gen(function* () {
            while (true) {
              const signal = yield* Queue.take(incoming);
              if (signal._tag === "ended") {
                close(current);
                yield* Queue.offer(current.signals, signal);
                return;
              }
              if (conversation !== current || !current.alive) continue;
              const origin = (signal.params as { readonly threadId?: string } | undefined)?.threadId;
              const child = origin === undefined ? undefined : current.children.get(origin);
              if (signal._tag === "request") {
                if (child !== undefined && current.stopping) {
                  current.rpc.respondError(signal.id, "The Codex subagent is stopping");
                } else if (child !== undefined) {
                  yield* handleRequest(current, setup, signal, child);
                } else if ((origin === undefined || origin === parentId) && turn !== undefined) {
                  yield* Queue.offer(current.signals, signal);
                } else {
                  current.rpc.respondError(signal.id, "wiki-agents has no active turn for this request");
                }
                continue;
              }
              const { method } = signal;
              if (method === "item/completed" && (origin === parentId || child !== undefined)) {
                const { item } = signal.params as Notifications["item/completed"];
                const launchingTurn = child?.state.turnId ?? turn?.id;
                if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent" && launchingTurn !== undefined) {
                  for (const subagentId of item.receiverThreadIds ?? []) {
                    if (current.children.has(subagentId)) continue;
                    const state: SubagentState = { turnId: launchingTurn, subagentId, label: item.prompt ?? "Codex subagent", agent: null, status: "running", result: null };
                    const spawned: CodexChild = { state, nativeTurnId: undefined, result: null, mapper: makeTurnMapper(launchingTurn, cwd, (itemId) => declined.get(itemId)), stopped: yield* Deferred.make<void>(), requests: new Set() };
                    current.children.set(subagentId, spawned);
                    publishChild(spawned, "running");
                  }
                }
              }
              if (child === undefined) {
                if ((origin === undefined || origin === parentId) && (turn !== undefined || method === "mcpServer/startupStatus/updated")) yield* Queue.offer(current.signals, signal);
                continue;
              }
              if (method === "turn/started") {
                if (child.state.status !== "running" && child.state.status !== "waiting") child.stopped = yield* Deferred.make<void>();
                child.nativeTurnId = (signal.params as Notifications["turn/completed"]).turn.id;
                child.result = null;
                publishChild(child, "running");
                if (current.stopping) yield* stopCodexTurn(current, child.nativeTurnId, child.state.subagentId);
              } else if (method === "turn/completed") {
                const { turn: completed } = signal.params as Notifications["turn/completed"];
                if (child.nativeTurnId !== undefined && child.nativeTurnId !== completed.id) continue;
                child.nativeTurnId = undefined;
                clearChildRequests(child);
                const result = completed.items?.findLast((item) => item.type === "agentMessage");
                const status = completed.status === "completed" ? "done" : completed.status === "failed" ? "failed" : "cancelled";
                publishChild(child, status, result?.text ?? child.result ?? completed.error?.message ?? null);
                yield* Deferred.succeed(child.stopped, undefined);
              } else if (method === "serverRequest/resolved") {
                const { requestId } = signal.params as { readonly requestId: JsonRpcId };
                for (const id of child.requests) {
                  if (requests.get(id)?.id !== requestId) continue;
                  requests.delete(id);
                  child.requests.delete(id);
                  yield* Queue.offer(background, { _tag: "request.closed", requestId: id });
                }
                if (child.requests.size === 0 && child.state.status === "waiting") publishChild(child, "running");
              } else if (method === "item/started" || method === "item/completed") {
                const { item } = signal.params as Notifications["item/completed"];
                if (method === "item/completed" && item.type === "agentMessage") child.result = item.text;
                child.mapper.map(method, signal.params as Notifications[typeof method]);
              }
            }
          });

          /**
           * Runs one of Codex's turns as the app's turn: `send` asks Codex to start it and
           * resolves with Codex's turn id when the answer has one (a compaction's
           * doesn't: `turn/started` says it). Notifications are mapped until it completes.
           */
          const execute = (
            turnId: string,
            setup: SessionSetup,
            send: (rpc: RpcClient, thread: string | null) => Promise<string | undefined>,
            compacting: boolean,
            failedToStart: string,
          ) =>
            Stream.callback<ProviderEvent, ProviderError>((out) =>
              Effect.gen(function* () {
                const current = yield* start(setup);
                const running: RunningTurn = { id: turnId, codexTurnId: undefined, stopping: false, ended: yield* Deferred.make<void>() };
                const mapper = makeTurnMapper(turnId, cwd, (itemId) => declined.get(itemId), { compacting });
                activeMapper = { conversation: current, mapper };
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    if (turn === running) turn = undefined;
                    if (activeMapper?.mapper === mapper) activeMapper = undefined;
                  }),
                );
                const thread = threadId;
                // Together, so a Stop either finds the turn or comes before its message was sent.
                yield* Effect.sync(() => {
                  current.stopping = false;
                  turn = running;
                  send(current.rpc, thread).then(
                    (codexTurnId) => codexTurnId !== undefined && Queue.offerUnsafe(current.signals, { _tag: "started", codexTurnId }),
                    (error: unknown) => Queue.offerUnsafe(current.signals, { _tag: "startFailed", reason: describeError(error) }),
                  );
                });
                const end = (events: ReadonlyArray<ProviderEvent>) =>
                  Effect.gen(function* () {
                    if (running.codexTurnId !== undefined) ended.add(running.codexTurnId);
                    yield* Queue.offerAll(out, events);
                    yield* Queue.end(out);
                    yield* Deferred.succeed(running.ended, undefined);
                    if (turn === running) turn = undefined;
                  });
                const learn = (codexTurnId: string) =>
                  Effect.gen(function* () {
                    if (running.codexTurnId !== undefined || ended.has(codexTurnId)) return;
                    running.codexTurnId = codexTurnId;
                    if (running.stopping) yield* stopCodexTurn(current, codexTurnId);
                  });

                while (true) {
                  const signal = yield* Queue.take(current.signals);
                  switch (signal._tag) {
                    case "ended": {
                      if (conversation === current) close(current);
                      const reason = signal.reason ?? null;
                      return yield* end([
                        { _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: reason === null ? CODEX_STOPPED : `${CODEX_STOPPED} (${reason})` },
                      ]);
                    }
                    case "startFailed":
                      return yield* end([{ _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: `${failedToStart}: ${signal.reason}` }]);
                    case "started":
                      yield* learn(signal.codexTurnId);
                      continue;
                    case "request":
                      yield* Queue.offerAll(out, yield* handleRequest(current, setup, signal));
                      continue;
                    case "notification":
                      break;
                  }
                  const { method, params } = signal;
                  if (method === "mcpServer/startupStatus/updated") {
                    const update = params as Notifications["mcpServer/startupStatus/updated"];
                    if (update.name === VAULT_SERVER && update.status === "failed" && !current.toolsReported && setup.vaultTools !== null) {
                      current.toolsReported = true;
                      const reason = (update.error ?? "it failed to start").replaceAll(setup.vaultTools.token, "[redacted]");
                      yield* Effect.logWarning(`thread vault tools not connected in Codex: ${reason}`);
                      yield* Queue.offer(out, { _tag: "notice", turnId, text: vaultToolsUnavailable(reason) });
                    }
                    continue;
                  }
                  if (method === "turn/started") {
                    yield* learn((params as { readonly turn: { readonly id: string } }).turn.id);
                    continue;
                  }
                  const of = method === "turn/completed" ? (params as Notifications["turn/completed"]).turn.id : (params as { readonly turnId?: unknown }).turnId;
                  if (typeof of === "string" && (ended.has(of) || (running.codexTurnId !== undefined && of !== running.codexTurnId))) continue;
                  const events = mapper.map(method as keyof Notifications, params as never);
                  if (method === "turn/completed") {
                    if (running.codexTurnId === undefined && typeof of === "string") running.codexTurnId = of;
                    return yield* end(events);
                  }
                  yield* Queue.offerAll(out, events);
                }
              }),
            );

          const startTurn = ({ turnId, text, images, setup }: TurnInput) =>
            execute(
              turnId,
              setup,
              (rpc, thread) =>
                rpc
                  .request<TurnStartResponse>("turn/start", { threadId: thread, input: turnInput(text, images), ...(model === null ? {} : { model }) })
                  .then((response) => response.turn.id),
              false,
              "Codex didn't start the turn",
            );

          /**
           * `thread/compact/start` answers at once and runs the compaction as a turn of its
           * own: `turn/started`, a `contextCompaction` item, `turn/completed`.
           */
          const compact = ({ turnId, setup }: CompactInput) =>
            execute(
              turnId,
              setup,
              (rpc, thread) => rpc.request<Record<string, never>>("thread/compact/start", { threadId: thread }).then(() => undefined),
              true,
              "Codex didn't start compacting",
            );

          const stopCodexTurn = (current: Conversation, codexTurnId: string, target = threadId) =>
            tryPromise(() => current.rpc.request("turn/interrupt", { threadId: target, turnId: codexTurnId }), "Codex didn't take the stop").pipe(
              Effect.catch((error) => Effect.logWarning(error.message)),
              Effect.forkDetach,
              Effect.asVoid,
            );

          const stopBackground = Effect.gen(function* () {
            const current = conversation;
            if (current === undefined || !current.alive) return;
            current.stopping = true;
            const children = [...current.children.values()].filter(({ state }) => state.status === "running" || state.status === "waiting");
            for (const child of children) {
              for (const id of child.requests) {
                const pending = requests.get(id);
                if (pending !== undefined) current.rpc.respond(pending.id, cancelled(pending));
              }
              clearChildRequests(child);
              if (child.nativeTurnId !== undefined) yield* stopCodexTurn(current, child.nativeTurnId, child.state.subagentId);
            }
            const stopped = yield* Effect.forEach(children, (child) => Deferred.await(child.stopped), { discard: true }).pipe(Effect.timeoutOption(stopWait));
            if (Option.isNone(stopped) && conversation === current) close(current);
          });

          /**
           * Stops the turn: pending approvals are cancelled, Codex is asked to stop,
           * and its result awaited. A process that doesn't confirm in time is closed;
           * the next turn resumes the thread in a new one.
           */
          const interrupt = (turnId: string) =>
            Effect.gen(function* () {
              const running = turn;
              const current = conversation;
              if (running === undefined || running.id !== turnId || current === undefined || !current.alive) return;
              current.stopping = true;
              if (running.codexTurnId === undefined) running.stopping = true;
              else yield* stopCodexTurn(current, running.codexTurnId);
              for (const [id, request] of requests) {
                if ([...current.children.values()].some((child) => child.requests.has(id))) continue;
                current.rpc.respond(request.id, cancelled(request));
                requests.delete(id);
              }
              yield* stopBackground;
              const stopped = yield* Deferred.await(running.ended).pipe(Effect.timeoutOption(stopWait));
              if (Option.isNone(stopped)) {
                yield* Effect.logWarning("Codex didn't confirm the stop; closing it");
                if (conversation === current) close(current);
              } else {
                yield* stopBackground;
              }
            });

          const answerRequest = (requestId: string, answer: RequestAnswer) =>
            Effect.gen(function* () {
              const request = requests.get(requestId);
              const current = conversation;
              if (request === undefined || current === undefined || !current.alive) return yield* new ProviderError({ message: "Codex is no longer waiting for this answer." });
              requests.delete(requestId);
              for (const child of current.children.values()) {
                if (child.requests.delete(requestId) && child.requests.size === 0) publishChild(child, "running");
              }
              if ((request.kind === "command" || request.kind === "fileChange") && !(answer._tag === "approval" && answer.decision === "approve")) {
                declined.set(request.itemId, DENIED);
              }
              current.rpc.respond(request.id, answered(request, answer));
            });

          yield* start(initialSetup);

          const session: ProviderSession = {
            get nativeSessionId() {
              return threadId;
            },
            startTurn,
            background: Stream.fromQueue(background),
            stopBackground,
            compact,
            // Codex runs as a child of this server and stops with it, taking any
            // pending approval with it, so there is nothing to resume.
            resumeTurn: () => Effect.succeed(Option.none()),
            interrupt,
            answerRequest,
            // Sent with the next turn, which keeps it for the turns after.
            setModel: (next) =>
              Effect.sync(() => {
                model = next;
              }),
          };
          return session;
        }),
    };
    return adapter;
  });
