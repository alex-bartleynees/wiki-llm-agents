import { randomUUID } from "node:crypto";
import { NodeFileSystem } from "@effect/platform-node";
import type { CanUseTool, HookCallback, Options, PermissionResult, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderModel, ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer, RequestPrompt } from "@wiki-agents/contracts/threads/model";
import { Clock, Deferred, Duration, Effect, FileSystem, Option, Queue, Stream } from "effect";
import {
  DENIED,
  type ModelList,
  type ProviderAdapter,
  ProviderError,
  type ProviderEvent,
  type ProviderSession,
  type SessionSetup,
  type TurnImage,
  type TurnInput,
  vaultToolsUnavailable,
} from "../port.js";
import { type AuthStatus, isSupportedVersion, notInstalled, resolveBinary, SUPPORTED_VERSION } from "./cli.js";
import { answeredInput, approvalPrompt, askedQuestions, makeTurnMapper, questionPrompt } from "./events.js";
import { appendedPrompt } from "./instructions.js";
import { decide, enforcedAutonomy } from "./permissions.js";
import { type ClaudeCodeSdk, type ClaudeQuery, type Input, makeInput, type MessageImage, userMessage } from "./sdk.js";

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

/** Why a turn ended when Claude Code exited under it. */
export const CLAUDE_STOPPED = "Claude Code stopped unexpectedly. Send a message to start it again.";

/** Told to the agent when its autonomy denies a tool. */
export const NOT_ALLOWED = "The agent's autonomy in this app doesn't allow this. Don't try it another way; say what you would have done.";

/** Where Claude Code's settings, skills, MCP servers and `CLAUDE.md` files come from: everywhere it reads them itself. */
export const SETTING_SOURCES: NonNullable<Options["settingSources"]> = ["user", "project", "local"];

/** How long a model list is reused before Claude Code is asked again. */
const MODELS_TTL = Duration.minutes(10);

/** Sources of credentials that are billed per token (an API key); a claude.ai login is a subscription. */
const BILLED = new Set<string>(["ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "user", "project", "org", "temporary"]);

/** Lines of Claude Code's stderr kept to explain a crash. */
const STDERR_LINES = 20;

type Signal =
  | { readonly _tag: "message"; readonly message: SDKMessage }
  | { readonly _tag: "request"; readonly requestId: string; readonly prompt: RequestPrompt }
  | { readonly _tag: "ended"; readonly reason: string | null };

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
}

interface PendingRequest {
  readonly resolve: (result: PermissionResult) => void;
  readonly input: Record<string, unknown>;
  readonly question: boolean;
}

interface RunningTurn {
  readonly id: string;
  /** Done when the turn's result arrived or the process ended. */
  readonly ended: Deferred.Deferred<void>;
}

const tryPromise = <A>(run: () => Promise<A>, message: string) =>
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
        const list: ModelList = {
          models: offered.map((model): ProviderModel => ({ id: model.value, name: model.displayName, free: false })),
          defaultModel: offered.some((model) => model.value === "default") ? "default" : null,
        };
        models = { at: now, list };
        return list;
      });

    const adapter: ProviderAdapter = {
      kind: "claude-code",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true },
      enforcement: enforcedAutonomy,
      status,
      listModels,
      openSession: ({ cwd, nativeSessionId, model: initialModel }) =>
        Effect.gen(function* () {
          const binary = yield* executable;
          const realCwd = yield* fs.realPath(cwd).pipe(Effect.mapError((cause) => new ProviderError({ message: `The working folder ${cwd} isn't there.`, cause })));
          const sessionId = nativeSessionId ?? randomUUID();
          /** Claude Code has saved the session, so a new process resumes it rather than starting it. */
          let saved = nativeSessionId !== null;
          let model = initialModel;
          let conversation: Conversation | undefined;
          let turn: RunningTurn | undefined;
          let latest: SessionSetup | undefined;
          const requests = new Map<string, PendingRequest>();
          const stderr: Array<string> = [];

          const cancelRequests = (message: string) => {
            for (const request of requests.values()) request.resolve({ behavior: "deny", message, interrupt: true });
            requests.clear();
          };

          const close = (current: Conversation) => {
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
                permissionDecision: decision,
                ...(decision === "deny" ? { permissionDecisionReason: NOT_ALLOWED } : {}),
              },
            };
          };

          const start = (setup: SessionSetup) =>
            Effect.gen(function* () {
              const append = appendedPrompt(setup.instructions, cwd);
              const key = append ?? "";
              if (conversation?.alive === true && conversation.key === key) return conversation;
              if (conversation !== undefined) close(conversation);
              const signals = yield* Queue.unbounded<Signal>();
              const input = makeInput();
              const resume = saved || (yield* tryPromise(() => sdk.sessionExists(sessionId, cwd), "Couldn't look for the Claude Code session"));

              /** An approval or question for the user; Claude Code waits for the answer. */
              const canUseTool: CanUseTool = async (toolName, toolInput, context) => {
                if (turn === undefined) return { behavior: "deny", message: "No turn is running." };
                const questions = toolName === "AskUserQuestion" ? askedQuestions(toolInput) : [];
                const prompt =
                  questions.length > 0
                    ? questionPrompt(questions)
                    : await withFs(approvalPrompt(toolName, toolInput, cwd, { blockedPath: context.blockedPath, decisionReason: context.decisionReason }));
                const requestId = randomUUID();
                return new Promise<PermissionResult>((resolve) => {
                  requests.set(requestId, { resolve, input: toolInput, question: questions.length > 0 });
                  context.signal.addEventListener(
                    "abort",
                    () => {
                      if (requests.delete(requestId)) resolve({ behavior: "deny", message: "Cancelled." });
                    },
                    { once: true },
                  );
                  Queue.offerUnsafe(signals, { _tag: "request", requestId, prompt });
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
                  additionalDirectories: (setup.projectRoots ?? []).filter((root) => root !== realCwd),
                  hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
                  canUseTool,
                  stderr: (data) => {
                    stderr.push(...data.split("\n").filter((line) => line.trim() !== ""));
                    stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
                  },
                },
              });
              const current: Conversation = { query, input, signals, key, alive: true, cost: 0, billed: false, tools: undefined };
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
              const key = JSON.stringify([tools.name, tools.url, tools.token]);
              if (current.tools === key) return [];
              const result = yield* tryPromise(
                () => current.query.setMcpServers({ [tools.name]: { type: "http", url: tools.url, headers: { Authorization: `Bearer ${tools.token}` } } }),
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

          const startTurn = ({ turnId, text, images, setup }: TurnInput) =>
            Stream.callback<ProviderEvent, ProviderError>((out) =>
              Effect.gen(function* () {
                latest = setup;
                const blocks = yield* Effect.forEach(images, (image) => messageImage(fs, image));
                const current = yield* start(setup);
                const notices = yield* applyTools(current, setup);
                yield* Queue.offerAll(out, notices.map((notice): ProviderEvent => ({ _tag: "notice", turnId, text: notice })));
                const running: RunningTurn = { id: turnId, ended: yield* Deferred.make<void>() };
                yield* Effect.addFinalizer(() => Effect.sync(() => turn === running && (turn = undefined)));
                // Together, so a Stop either finds the turn or comes before its message was sent.
                yield* Effect.sync(() => {
                  turn = running;
                  current.input.push(userMessage(notices.length === 0 ? text : `${text}\n\nApp notices for this turn:\n${notices.join("\n")}`, blocks));
                });
                const mapper = makeTurnMapper(turnId, cwd, (result: SDKResultMessage) => {
                  const spent = Math.max(0, result.total_cost_usd - current.cost);
                  current.cost = result.total_cost_usd;
                  return current.billed ? spent : null;
                });
                const end = (events: ReadonlyArray<ProviderEvent>) =>
                  Effect.gen(function* () {
                    yield* Queue.offerAll(out, events);
                    yield* Queue.end(out);
                    yield* Deferred.succeed(running.ended, undefined);
                    if (turn === running) turn = undefined;
                  });

                while (true) {
                  const signal = yield* Queue.take(current.signals);
                  if (signal._tag === "ended") {
                    if (conversation === current) close(current);
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
                  if (message.type === "system" && message.subtype === "init") {
                    current.billed = BILLED.has(message.apiKeySource);
                    continue;
                  }
                  const events = mapper.map(message);
                  if (message.type === "result") {
                    saved = true;
                    return yield* end(events);
                  }
                  yield* Queue.offerAll(out, events);
                }
              }),
            );

          /**
           * Stops the turn: pending approvals are cancelled, Claude Code is asked to
           * stop, and its result awaited. A process that doesn't confirm in time is
           * closed; the next turn resumes the session in a new one.
           */
          const interrupt = (turnId: string) =>
            Effect.gen(function* () {
              const running = turn;
              const current = conversation;
              if (running === undefined || running.id !== turnId || current === undefined || !current.alive) return;
              cancelRequests("The user stopped the turn.");
              yield* tryPromise(() => current.query.interrupt(), "Claude Code didn't take the stop").pipe(
                Effect.catch((error) => Effect.logWarning(error.message)),
              );
              const ended = yield* Deferred.await(running.ended).pipe(Effect.timeoutOption(stopWait));
              if (Option.isNone(ended)) {
                yield* Effect.logWarning("Claude Code didn't confirm the stop; closing it");
                if (conversation === current) close(current);
              }
            });

          const answerRequest = (requestId: string, answer: RequestAnswer) =>
            Effect.gen(function* () {
              const request = requests.get(requestId);
              if (request === undefined) return yield* new ProviderError({ message: "Claude Code is no longer waiting for this answer." });
              requests.delete(requestId);
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
            // Claude Code runs as a child of this server and stops with it, taking any
            // pending approval with it, so there is nothing to resume.
            resumeTurn: () => Effect.succeed(Option.none()),
            interrupt,
            answerRequest,
            setModel,
          };
          return session;
        }),
    };
    return adapter;
  });
