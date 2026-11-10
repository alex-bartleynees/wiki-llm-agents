import type { ProviderStatus } from "@wiki-agents/contracts/providers/model";
import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { Duration, Effect, Option, PubSub, Queue, RcRef, type Scope, Stream } from "effect";
import { type ProviderAdapter, ProviderError, type ProviderEvent, type ProviderSession } from "../port.js";
import type { OpenCodeApi, OpenCodeError, OpenCodeEvent, OpenCodePermissionRule, OpenCodeSignal } from "./api.js";
import { formAnswer, makeTurnMapper, sessionOf } from "./events.js";
import { CLIENT_VERSION, isSupportedVersion } from "./server.js";

/** Tools that only read (or ask you something); everything else asks first. */
export const READ_ONLY_ACTIONS = ["read", "glob", "grep", "list", "lsp", "question", "todowrite", "skill"] as const;

/**
 * Until agents have their own autonomy (slice 6), every OpenCode session asks
 * before anything but reading: editing or creating files (`edit`), commands
 * (`shell`), the web (`webfetch`, `websearch`), files outside the vault, and any
 * tool this list doesn't know. OpenCode applies the last matching rule, so the
 * read-only allowances follow the catch-all. The app always answers `once`:
 * OpenCode stores `always` for the whole project, which would widen every other
 * thread's permissions.
 */
export const SESSION_PERMISSIONS: ReadonlyArray<OpenCodePermissionRule> = [
  { action: "*", resource: "*", effect: "ask" },
  ...READ_ONLY_ACTIONS.map((action) => ({ action, resource: "*", effect: "allow" }) as const),
];

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

/** Sent with a denial, so the agent carries on instead of the turn ending. */
export const DENIED = "The user denied this. Don't try it another way; say what you would have done.";

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

/** The next event of `sessionId` from a subscription, or a reconnect; None after `wait`. */
const nextSignal = (subscription: PubSub.Subscription<OpenCodeSignal>, sessionId: string, wait: Duration.Input) =>
  Effect.gen(function* () {
    while (true) {
      const signal = yield* PubSub.take(subscription);
      if (signal._tag === "reconnected" || sessionOf(signal.event) === sessionId) return signal;
    }
  }).pipe(Effect.timeoutOption(wait));

const makeSession = (api: OpenCodeApi, sessionId: string, cwd: string, silence: Duration.Input): ProviderSession => {
  let turn: RunningTurn | undefined;
  const requests = new Map<string, PendingRequest>();

  const startTurn = ({ turnId, text }: { readonly turnId: string; readonly text: string }) =>
    Stream.callback<ProviderEvent, ProviderError>((queue) =>
      Effect.gen(function* () {
        // Subscribe before sending: OpenCode's stream is live only.
        const subscription = yield* api.subscribe;
        const current: RunningTurn = { id: turnId, inboxId: undefined, started: false };
        turn = current;
        current.inboxId = yield* api.prompt(sessionId, text).pipe(Effect.mapError(toProviderError));
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
          if (Option.isNone(signal) || signal.value._tag === "reconnected") {
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
        const subscription = yield* api.subscribe;
        const ended = Effect.gen(function* () {
          while (true) {
            const signal = yield* PubSub.take(subscription);
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
    setModel: (model) => api.switchModel(sessionId, model).pipe(Effect.mapError(toProviderError)),
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

    const status: Effect.Effect<ProviderStatus> = Effect.gen(function* () {
      const installed = yield* options.installedVersion;
      if (!isSupportedVersion(installed)) {
        return { _tag: "unavailable", reason: `OpenCode ${installed} is installed; this app supports ${CLIENT_VERSION.replace(/\.\d+$/, ".x")}.` } as const;
      }
      const api = yield* Effect.scoped(RcRef.get(server));
      return { _tag: "ready", version: api.version } as const;
    }).pipe(Effect.catch((error) => Effect.succeed({ _tag: "unavailable", reason: error.message } as const)));

    const adapter: ProviderAdapter = {
      kind: "opencode",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true },
      openSession: ({ cwd, nativeSessionId, model }) =>
        Effect.gen(function* () {
          const api = yield* RcRef.get(server);
          const existing = nativeSessionId !== null && (yield* api.sessionExists(nativeSessionId));
          if (existing && nativeSessionId !== null) {
            // The session keeps the rules it was made with; bring them up to date.
            yield* api.setPermissions(nativeSessionId, SESSION_PERMISSIONS);
            return makeSession(api, nativeSessionId, cwd, silence);
          }
          const sessionId = yield* api.createSession({ directory: cwd, model, permissions: SESSION_PERMISSIONS });
          return makeSession(api, sessionId, cwd, silence);
        }).pipe(Effect.mapError(toProviderError)),
      status,
      listModels: (cwd) =>
        Effect.scoped(
          Effect.gen(function* () {
            const api = yield* RcRef.get(server);
            const [models, defaultModel] = yield* Effect.all([api.listModels(cwd), api.defaultModel(cwd)], { concurrency: 2 });
            return { models, defaultModel };
          }),
        ).pipe(Effect.mapError(toProviderError)),
    };
    return adapter;
  });
