import { NodeFileSystem } from "@effect/platform-node";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { Duration, Effect, Exit, FileSystem, Option, PubSub, Queue, RcRef, Scope, Stream } from "effect";
import { pathsWithinRoots } from "../../../shared/vault/path-scope.js";
import { type ProviderAdapter, ProviderError, type ProviderEvent, type ProviderSession, type SessionSetup, type TurnInput, DENIED, vaultToolsUnavailable } from "../port.js";
import type { OpenCodeApi, OpenCodeError, OpenCodeEvent, OpenCodePermissionRule, OpenCodeSignal } from "./api.js";
import { formAnswer, makeTurnMapper, sessionOf } from "./events.js";
import { instructionsText, MAX_INSTRUCTIONS_BYTES } from "./instructions.js";
import { enforcedAutonomy, permissionRules } from "./permissions.js";
import { CLIENT_VERSION, isSupportedVersion } from "./server.js";

/**
 * A session's rules without an agent: read freely, ask before anything else (see
 * `permissions.ts`). The app always answers `once`: OpenCode stores `always` for
 * the whole project, which would widen every other thread's permissions.
 */
export const SESSION_PERMISSIONS: ReadonlyArray<OpenCodePermissionRule> = permissionRules(DEFAULT_AUTONOMY);

export interface OpenCodeAdapterOptions {
  /** Starts an OpenCode server; it stops when the scope closes. */
  readonly start: Effect.Effect<OpenCodeApi, OpenCodeError, Scope.Scope>;
  /** The installed OpenCode's version, read without starting a server. */
  readonly installedVersion: Effect.Effect<string, OpenCodeError>;
  /** How long a running turn may go without events before the adapter checks on it. */
  readonly silence?: Duration.Input;
  /** How long the server keeps running once no thread uses it. */
  readonly idleTime?: Duration.Input;
}

const toProviderError = (error: OpenCodeError) => new ProviderError({ message: error.message, cause: error });

const END_EVENTS = new Set<string>(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]);

export { DENIED } from "../port.js";

/** How long Stop waits for OpenCode to confirm the turn ended. */
const STOP_WAIT = Duration.seconds(5);

type PendingRequest =
  | { readonly kind: "permission" }
  | { readonly kind: "form"; readonly event: Extract<OpenCodeEvent, { readonly type: "form.created" }> };

interface RunningTurn {
  readonly id: string;
  /** The message's inbox id, until OpenCode takes it. */
  inboxId: string | undefined;
  /** OpenCode started running it (`session.execution.started`). */
  started: boolean;
}

/** Why a turn ended when OpenCode exited under it. */
export const OPENCODE_STOPPED = "OpenCode stopped unexpectedly. Send a message to start it again.";

/** The next event of `sessionId` from a subscription, a reconnect, or the server stopping; None after `wait`. */
const nextSignal = (subscription: PubSub.Subscription<OpenCodeSignal>, sessionId: string, wait: Duration.Input) =>
  Effect.gen(function* () {
    while (true) {
      const signal = yield* PubSub.take(subscription);
      if (signal._tag !== "event" || sessionOf(signal.event) === sessionId) return signal;
    }
  }).pipe(Effect.timeoutOption(wait));

/**
 * The OpenCode server a session uses: the shared one, held in the session's scope,
 * or a new one when that has stopped.
 */
type Connect = Effect.Effect<OpenCodeApi, ProviderError>;

/** What the session was last given, so a turn sends only what changed. */
interface Applied {
  /** The permission rules, as JSON. */
  rules: string;
  /** The instructions entry; undefined until set by this run of the app. */
  instructions: string | null | undefined;
  /** The vault tools entry OpenCode has, on which server; undefined until one is registered. */
  tools: { readonly api: OpenCodeApi; readonly name: string; readonly key: string } | undefined;
}

const sessionRules = (setup: SessionSetup) => permissionRules(setup.autonomy, setup.vaultTools?.name ?? null);
const rulesKey = (setup: SessionSetup) => JSON.stringify(sessionRules(setup));

export { vaultToolsUnavailable } from "../port.js";

const makeSession = (connect: Connect, sessionId: string, cwd: string, silence: Duration.Input, applied: Applied, fs: FileSystem.FileSystem): ProviderSession => {
  let turn: RunningTurn | undefined;
  const requests = new Map<string, PendingRequest>();

  /**
   * Registers the thread's vault tools with OpenCode when they are new, changed (a
   * new token), or on a new server (after a crash). A failure leaves the turn to run
   * without them; it returns why, for the user. The token never goes in a log.
   */
  const applyTools = (api: OpenCodeApi, setup: SessionSetup) =>
    Effect.gen(function* () {
      const tools = setup.vaultTools;
      if (tools === null) return [];
      const key = `${tools.name}\0${tools.url}\0${tools.token}`;
      if (applied.tools?.api === api && applied.tools.key === key) return [];
      const added = yield* Effect.result(api.addMcpServer(cwd, tools));
      const rawReason = added._tag === "Failure" ? added.failure.message : added.success._tag === "failed" ? added.success.reason : undefined;
      const reason = rawReason?.replaceAll(tools.token, "[redacted]");
      if (reason !== undefined) {
        applied.tools = undefined;
        yield* Effect.logWarning(`thread vault tools (${tools.name}) not registered with OpenCode: ${reason}`);
        return [vaultToolsUnavailable(reason)];
      }
      applied.tools = { api, name: tools.name, key };
      return [];
    });

  /** Brings the session's permissions, instructions and vault tools up to date with `setup`; returns notices for the user. */
  const apply = (api: OpenCodeApi, setup: SessionSetup) =>
    Effect.gen(function* () {
      const rules = rulesKey(setup);
      if (rules !== applied.rules) {
        yield* api.setPermissions(sessionId, sessionRules(setup));
        applied.rules = rules;
      }
      const instructions = instructionsText(setup.instructions, cwd);
      if (instructions !== applied.instructions) {
        if (instructions !== null && Buffer.byteLength(instructions, "utf8") > MAX_INSTRUCTIONS_BYTES) {
          return yield* new ProviderError({
            message: `The rules and agent instructions are ${Math.ceil(Buffer.byteLength(instructions, "utf8") / 1024)} KiB; OpenCode takes at most ${MAX_INSTRUCTIONS_BYTES / 1024} KiB.`,
          });
        }
        // On the first turn of this run `applied.instructions` is unknown, so this also
        // removes instructions an earlier run left on a continued session.
        yield* api.setInstructions(sessionId, instructions);
        applied.instructions = instructions;
      }
      return yield* applyTools(api, setup);
    }).pipe(Effect.mapError((error) => (error instanceof ProviderError ? error : toProviderError(error))));

  /**
   * OpenCode asks before the agent reaches outside the session's folder (the main
   * working directory). In a project thread, the project's other working directories
   * and the shared vault belong to it: allow those once, and the action itself then
   * follows the agent's autonomy like any other. Anywhere else goes to you. True when
   * answered here.
   */
  const answerInProject = (api: OpenCodeApi, setup: SessionSetup, request: { readonly id: string; readonly action: string; readonly resources: ReadonlyArray<string> }) =>
    Effect.gen(function* () {
      if (setup.projectRoots === null || request.action !== "external_directory") return false;
      const inside = yield* pathsWithinRoots(setup.projectRoots, cwd, request.resources).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      if (!inside) return false;
      yield* api.replyPermission(sessionId, request.id, "once").pipe(Effect.mapError(toProviderError));
      return true;
    });

  const startTurn = ({ turnId, text, setup }: TurnInput) =>
    Stream.callback<ProviderEvent, ProviderError>((queue) =>
      Effect.gen(function* () {
        const api = yield* connect;
        const notices = yield* apply(api, setup);
        yield* Queue.offerAll(queue, notices.map((text): ProviderEvent => ({ _tag: "notice", turnId, text })));
        // Subscribe before sending: OpenCode's stream is live only.
        const subscription = yield* api.subscribe;
        const current: RunningTurn = { id: turnId, inboxId: undefined, started: false };
        turn = current;
        current.inboxId = yield* api.prompt(sessionId, notices.length ? `${text}\n\nApp notices for this turn:\n${notices.join("\n")}` : text).pipe(Effect.mapError(toProviderError));
        const mapper = makeTurnMapper(turnId, cwd);
        const waiting = new Set<string>();
        /** Checks that found the message still queued and nothing running. */
        let neverStarted = 0;

        const end = (events: ReadonlyArray<ProviderEvent>) =>
          Effect.gen(function* () {
            yield* Queue.offerAll(queue, events);
            yield* Queue.end(queue);
            if (turn === current) turn = undefined;
          });

        /** No events for a while, or the stream reconnected: ask OpenCode how the turn is doing. */
        const checkOn = Effect.gen(function* () {
          if (yield* api.isRunning(sessionId)) return false;
          if (!current.started) {
            if (++neverStarted < 2) return false;
            yield* end([{ _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: "OpenCode never started the turn." }]);
            return true;
          }
          const outcome = yield* api.lastOutcome(sessionId);
          const usage = mapper.usage();
          yield* end([
            outcome === "succeeded"
              ? { _tag: "turn.finished", turnId, outcome: "completed", usage, reason: null }
              : outcome === "interrupted"
                ? { _tag: "turn.finished", turnId, outcome: "interrupted", usage, reason: "OpenCode stopped the turn." }
                : { _tag: "turn.finished", turnId, outcome: "failed", usage, reason: "OpenCode's turn ended without saying how." },
          ]);
          return true;
        }).pipe(Effect.mapError(toProviderError));

        while (true) {
          const signal = yield* nextSignal(subscription, sessionId, silence);
          if (Option.isSome(signal) && signal.value._tag === "stopped") {
            // OpenCode's pending approvals and questions went with it.
            requests.clear();
            return yield* end([{ _tag: "turn.finished", turnId, outcome: "failed", usage: mapper.usage(), reason: OPENCODE_STOPPED }]);
          }
          if (Option.isNone(signal) || signal.value._tag !== "event") {
            const quiet = Option.isNone(signal) && waiting.size > 0;
            if (!quiet && (yield* checkOn)) return;
            continue;
          }
          const event = signal.value.event;
          switch (event.type) {
            case "session.execution.started":
              current.started = true;
              current.inboxId = undefined;
              break;
            case "permission.asked":
              if (yield* answerInProject(api, setup, event.data)) continue;
              requests.set(event.data.id, { kind: "permission" });
              waiting.add(event.data.id);
              break;
            case "form.created":
              requests.set(event.data.form.id, { kind: "form", event });
              waiting.add(event.data.form.id);
              break;
            case "permission.replied":
              waiting.delete(event.data.requestID);
              requests.delete(event.data.requestID);
              break;
            case "form.replied":
            case "form.cancelled":
              waiting.delete(event.data.id);
              requests.delete(event.data.id);
              break;
          }
          // The end of an earlier turn can arrive after this one was sent; only this turn's end counts.
          if (END_EVENTS.has(event.type) && !current.started) continue;
          const events = mapper.map(event);
          if (events.some((mapped) => mapped._tag === "turn.finished")) return yield* end(events);
          yield* Queue.offerAll(queue, events);
        }
      }),
    );

  /**
   * Stops the turn. Straight after Send, OpenCode may not have started it yet, and
   * its interrupt does nothing then: withdraw the message if it is still queued,
   * otherwise wait for the turn to start and stop it. Returns once OpenCode has
   * confirmed, or after a few seconds.
   */
  const interrupt = (turnId: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const current = turn;
        if (current === undefined || current.id !== turnId) return;
        turn = undefined;
        const api = yield* connect;
        if (yield* api.isStopped) return;
        const subscription = yield* api.subscribe;
        const ended = Effect.gen(function* () {
          while (true) {
            const signal = yield* PubSub.take(subscription);
            if (signal._tag === "stopped") return;
            if (signal._tag === "event" && sessionOf(signal.event) === sessionId && END_EVENTS.has(signal.event.type)) return;
          }
        });
        if (!current.started && current.inboxId !== undefined) {
          const withdrawn = yield* api.cancelPrompt(sessionId, current.inboxId).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          );
          if (withdrawn && !(yield* api.isRunning(sessionId))) return;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          if (yield* api.interrupt(sessionId)) return yield* Effect.timeoutOption(ended, STOP_WAIT);
          if (!(yield* api.isRunning(sessionId))) {
            const started = yield* nextSignal(subscription, sessionId, Duration.seconds(1));
            if (Option.isNone(started)) return;
          }
        }
        return;
      }).pipe(
        Effect.catch((error) => Effect.logWarning("OpenCode didn't confirm the stop", error)),
        Effect.asVoid,
      ),
    );

  const answerRequest = (requestId: string, answer: RequestAnswer) =>
    Effect.gen(function* () {
      const request = requests.get(requestId);
      if (request === undefined) return yield* new ProviderError({ message: "OpenCode is no longer waiting for this answer." });
      requests.delete(requestId);
      const api = yield* connect;
      if (request.kind === "permission") {
        const approved = answer._tag === "approval" && answer.decision === "approve";
        return yield* (approved ? api.replyPermission(sessionId, requestId, "once") : api.replyPermission(sessionId, requestId, "reject", DENIED)).pipe(
          Effect.mapError(toProviderError),
        );
      }
      const text = answer._tag === "question" ? answer.text : "";
      return yield* api.replyForm(sessionId, requestId, formAnswer(request.event, text)).pipe(Effect.mapError(toProviderError));
    });

  return {
    nativeSessionId: sessionId,
    startTurn,
    // OpenCode runs inside this server; when it stops, OpenCode cancels the turn and
    // its pending approvals, so there is nothing to resume.
    resumeTurn: () => Effect.succeed(Option.none()),
    interrupt,
    answerRequest,
    setModel: (model) => Effect.flatMap(connect, (api) => api.switchModel(sessionId, model).pipe(Effect.mapError(toProviderError))),
  };
};

/**
 * OpenCode 2. One `opencode serve` is shared by every thread: it starts with the
 * first session and stops after `idleTime` with none. Each thread is an OpenCode
 * session in the thread's working directory, kept on the thread and continued
 * after a restart.
 */
export const makeOpenCodeAdapter = (options: OpenCodeAdapterOptions) =>
  Effect.gen(function* () {
    const server = yield* RcRef.make({ acquire: options.start, idleTimeToLive: options.idleTime ?? "5 minutes" });
    const silence = options.silence ?? Duration.seconds(45);
    // OpenCode runs on this machine; its paths are checked on this machine's file system.
    const fs = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* FileSystem.FileSystem;
      }),
      NodeFileSystem.layer,
    );

    /** The running server in the current scope; a new one if the cached one stopped (crashed). */
    const live = Effect.gen(function* () {
      const api = yield* RcRef.get(server);
      if (!(yield* api.isStopped)) return api;
      yield* RcRef.invalidate(server);
      return yield* RcRef.get(server);
    });

    const status: Effect.Effect<ProviderStatus> = Effect.gen(function* () {
      const installed = yield* options.installedVersion;
      if (!isSupportedVersion(installed)) {
        return { _tag: "unavailable", reason: `OpenCode ${installed} is installed; this app supports ${CLIENT_VERSION.replace(/\.\d+$/, ".x")}.` } as const;
      }
      const api = yield* Effect.scoped(live);
      return { _tag: "ready", version: api.version, account: null } as const;
    }).pipe(Effect.catch((error) => Effect.succeed({ _tag: "unavailable", reason: error.message } as const)));

    const adapter: ProviderAdapter = {
      kind: "opencode",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: false },
      enforcement: enforcedAutonomy,
      openSession: ({ cwd, nativeSessionId, model, setup }) =>
        Effect.gen(function* () {
          // The session holds one server at a time, in a scope of its own inside the
          // session's, swapped for a new server when the held one has stopped.
          const sessionScope = yield* Effect.scope;
          let held: { readonly api: OpenCodeApi; readonly scope: Scope.Closeable } | undefined;
          const connect: Connect = Effect.gen(function* () {
            if (held !== undefined && !(yield* held.api.isStopped)) return held.api;
            if (held !== undefined) yield* Scope.close(held.scope, Exit.void);
            const scope = yield* Scope.fork(sessionScope);
            const api = yield* live.pipe(Scope.provide(scope));
            held = { api, scope };
            return api;
          }).pipe(Effect.mapError(toProviderError));

          const api = yield* connect;
          const rules = sessionRules(setup);
          const applied: Applied = { rules: rulesKey(setup), instructions: undefined, tools: undefined };
          // Added after `connect`, so it runs before the server is let go: the thread's
          // entry goes with its actor. (A stopped server took its entries with it.)
          yield* Effect.addFinalizer(() => {
            const tools = applied.tools;
            if (tools === undefined) return Effect.void;
            return Effect.gen(function* () {
              if (yield* tools.api.isStopped) return;
              yield* tools.api.removeMcpServer(cwd, tools.name);
            }).pipe(Effect.catch((error) => Effect.logWarning(`couldn't remove ${tools.name} from OpenCode: ${error.message}`)));
          });
          const existing = nativeSessionId !== null && (yield* api.sessionExists(nativeSessionId).pipe(Effect.mapError(toProviderError)));
          if (existing && nativeSessionId !== null) {
            // The session keeps the rules it was made with; bring them up to date.
            yield* api.setPermissions(nativeSessionId, rules).pipe(Effect.mapError(toProviderError));
            return makeSession(connect, nativeSessionId, cwd, silence, applied, fs);
          }
          const sessionId = yield* api
            .createSession({ directory: cwd, model, permissions: rules })
            .pipe(Effect.mapError(toProviderError));
          return makeSession(connect, sessionId, cwd, silence, applied, fs);
        }),
      status,
      listModels: (cwd) =>
        Effect.scoped(
          Effect.gen(function* () {
            const api = yield* live;
            const [models, defaultModel] = yield* Effect.all([api.listModels(cwd), api.defaultModel(cwd)], { concurrency: 2 });
            return { models, defaultModel };
          }),
        ).pipe(Effect.mapError(toProviderError)),
    };
    return adapter;
  });
