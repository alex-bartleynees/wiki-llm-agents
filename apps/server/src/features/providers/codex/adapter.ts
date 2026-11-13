import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { NodeFileSystem } from "@effect/platform-node";
import type { ProviderModel, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer, RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Clock, Deferred, Duration, Effect, FileSystem, Option, Queue, Stream } from "effect";
import { resolveBinary } from "../binary.js";
import {
  DENIED,
  type ModelList,
  type ProviderAdapter,
  ProviderError,
  type ProviderEvent,
  type ProviderSession,
  type SessionSetup,
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
import { APPROVAL_POLICY, autonomyConfig, decideCommand, decideFileChange, enforcedAutonomy, SANDBOX } from "./permissions.js";
import type {
  CommandApprovalParams,
  ElicitationParams,
  FileChangeApprovalParams,
  JsonRpcId,
  ModelListResponse,
  Notifications,
  PermissionsApprovalParams,
  ThreadParams,
  ThreadResponse,
  TurnStartResponse,
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
  /** The setup it was started with. */
  readonly key: string;
  alive: boolean;
  /** The vault tools failed to start, and the user was told. */
  toolsReported: boolean;
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
          models: visible.map((model): ProviderModel => ({ id: model.id, name: model.displayName, free: false })),
          defaultModel: visible.find((model) => model.isDefault)?.id ?? null,
        };
        models = { at: now, list };
        return list;
      });

    const adapter: ProviderAdapter = {
      kind: "codex",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true },
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
          const requests = new Map<string, PendingRequest>();
          /** Why Codex didn't run an item (autonomy or you declined it), by item id. */
          const declined = new Map<string, string>();
          /** Codex turns that have ended; their late notifications are ignored. */
          const ended = new Set<string>();

          const cancelRequests = (current: Conversation | undefined) => {
            if (current?.alive === true) for (const request of requests.values()) current.rpc.respond(request.id, cancelled(request));
            requests.clear();
          };

          const close = (current: Conversation) => {
            cancelRequests(current);
            current.alive = false;
            current.rpc.kill();
          };
          yield* Effect.addFinalizer(() => Effect.sync(() => conversation !== undefined && close(conversation)));

          /** Starts (or resumes) the thread in a new app-server unless the running one has this setup. */
          const start = (setup: SessionSetup) =>
            Effect.gen(function* () {
              const instructions = developerInstructions(setup.instructions, realCwd, gitRoot);
              const tools = setup.vaultTools;
              const config = {
                ...autonomyConfig(setup.autonomy),
                ...(tools === null ? {} : { [`mcp_servers.${VAULT_SERVER}`]: { url: tools.url, bearer_token_env_var: TOKEN_ENV } }),
              };
              const key = JSON.stringify([instructions, config, tools?.token ?? null]);
              if (conversation?.alive === true && conversation.key === key) return conversation;
              if (conversation !== undefined) close(conversation);
              const signals = yield* Queue.unbounded<Signal>();
              let current: Conversation | undefined;
              const rpc = makeRpc(
                launcher.launch({ binary, cwd, env: tools === null ? {} : { [TOKEN_ENV]: tools.token } }),
                (message) => Queue.offerUnsafe(signals, message),
                (reason) => {
                  if (current !== undefined) current.alive = false;
                  Queue.offerUnsafe(signals, { _tag: "ended", reason });
                },
              );
              current = { rpc, signals, key, alive: true, toolsReported: false };
              conversation = current;
              const params: ThreadParams = {
                cwd,
                ...(model === null ? {} : { model }),
                approvalPolicy: APPROVAL_POLICY,
                sandbox: SANDBOX,
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
              return current;
            });

          yield* start(initialSetup);

          /** Answers a request Codex sends during a turn from the autonomy, or opens it for you. */
          const handleRequest = (current: Conversation, setup: SessionSetup, request: Extract<Incoming, { readonly _tag: "request" }>): Effect.Effect<ReadonlyArray<ProviderEvent>> =>
            Effect.gen(function* () {
              const ask = (pending: PendingRequest, prompt: RequestPrompt): Effect.Effect<ReadonlyArray<ProviderEvent>> =>
                Effect.sync(() => {
                  const requestId = randomUUID();
                  requests.set(requestId, pending);
                  return turn === undefined ? [] : [{ _tag: "request.opened", turnId: turn.id, requestId, prompt }];
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
                  return yield* decide(decideCommand(setup.autonomy), { kind: "command", id: request.id, itemId: params.itemId }, Effect.sync(() => commandPrompt(params, cwd)));
                }
                case "item/fileChange/requestApproval": {
                  const params = request.params as FileChangeApprovalParams;
                  const changes = mapperOf(current)?.fileChange(params.itemId) ?? [];
                  const level = yield* withFs(decideFileChange({ autonomy: setup.autonomy, roots: setup.projectRoots ?? [realCwd], cwd, changes }));
                  return yield* decide(level, { kind: "fileChange", id: request.id, itemId: params.itemId }, withFs(fileChangePrompt(changes, cwd, params.reason)));
                }
                case "item/permissions/requestApproval": {
                  const params = request.params as PermissionsApprovalParams;
                  return yield* ask({ kind: "permissions", id: request.id, params }, permissionsPrompt(params));
                }
                case "item/tool/requestUserInput": {
                  const params = request.params as UserInputParams;
                  return yield* ask({ kind: "userInput", id: request.id, params }, questionPrompt(params.questions));
                }
                case "mcpServer/elicitation/request": {
                  const params = request.params as ElicitationParams;
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

          const startTurn = ({ turnId, text, setup }: TurnInput) =>
            Stream.callback<ProviderEvent, ProviderError>((out) =>
              Effect.gen(function* () {
                const current = yield* start(setup);
                const running: RunningTurn = { id: turnId, codexTurnId: undefined, stopping: false, ended: yield* Deferred.make<void>() };
                const mapper = makeTurnMapper(turnId, cwd, (itemId) => declined.get(itemId));
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
                  turn = running;
                  current.rpc
                    .request<TurnStartResponse>("turn/start", {
                      threadId: thread,
                      input: [{ type: "text", text, text_elements: [] }],
                      ...(model === null ? {} : { model }),
                    })
                    .then(
                      (response) => Queue.offerUnsafe(current.signals, { _tag: "started", codexTurnId: response.turn.id }),
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
                      return yield* end([{ _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: `Codex didn't start the turn: ${signal.reason}` }]);
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

          const stopCodexTurn = (current: Conversation, codexTurnId: string) =>
            tryPromise(() => current.rpc.request("turn/interrupt", { threadId, turnId: codexTurnId }), "Codex didn't take the stop").pipe(
              Effect.catch((error) => Effect.logWarning(error.message)),
              Effect.forkDetach,
              Effect.asVoid,
            );

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
              cancelRequests(current);
              if (running.codexTurnId === undefined) running.stopping = true;
              else yield* stopCodexTurn(current, running.codexTurnId);
              const stopped = yield* Deferred.await(running.ended).pipe(Effect.timeoutOption(stopWait));
              if (Option.isNone(stopped)) {
                yield* Effect.logWarning("Codex didn't confirm the stop; closing it");
                if (conversation === current) close(current);
              }
            });

          const answerRequest = (requestId: string, answer: RequestAnswer) =>
            Effect.gen(function* () {
              const request = requests.get(requestId);
              const current = conversation;
              if (request === undefined || current === undefined || !current.alive) return yield* new ProviderError({ message: "Codex is no longer waiting for this answer." });
              requests.delete(requestId);
              if ((request.kind === "command" || request.kind === "fileChange") && !(answer._tag === "approval" && answer.decision === "approve")) {
                declined.set(request.itemId, DENIED);
              }
              current.rpc.respond(request.id, answered(request, answer));
            });

          const session: ProviderSession = {
            get nativeSessionId() {
              return threadId;
            },
            startTurn,
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
