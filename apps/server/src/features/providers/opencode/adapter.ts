import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { ProviderStatus } from "@wiki-agents/contracts/providers/model";
import { isSubagentActive, type RequestAnswer, type SubagentReport } from "@wiki-agents/contracts/threads/model";
import { type Cause, Duration, Effect, Exit, FileSystem, Option, PubSub, Queue, RcRef, Scope, Stream } from "effect";
import { pathsWithinRoots } from "../../../shared/vault/path-scope.js";
import { revisedEntryName } from "../../mcp/thread-mcp-registration.js";
import {
  type BackgroundEvent,
  type CompactInput,
  type ProviderAdapter,
  ProviderError,
  type ProviderEvent,
  type ProviderSession,
  type SessionSetup,
  type SubagentState,
  type TurnImage,
  type TurnInput,
  DENIED,
  SECRET_DENIED,
  vaultToolsUnavailable,
} from "../port.js";
import type { OpenCodeApi, OpenCodeError, OpenCodeEvent, OpenCodeFile, OpenCodePermissionRule, OpenCodeSignal } from "./api.js";
import { approvalPrompt, childCreated, childReport, formAnswer, isRouter, makeTurnMapper, questionPrompt, sessionOf } from "./events.js";
import { instructionsText, MAX_INSTRUCTIONS_BYTES } from "./instructions.js";
import { commandNamesProtected, reachesProtected } from "../../../shared/secret-paths.js";
import { enforcedAutonomy, FILE_ACTIONS, levelBehindNameCheck, permissionRules, SEARCH_ACTIONS } from "./permissions.js";
import { isSupportedVersion, supportedVersionsText } from "./server.js";

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

/** OpenCode no longer has the request: it was settled already (the turn ended, or OpenCode settled it with another). */
const alreadySettled = (error: OpenCodeError) => (error.cause as { readonly _tag?: unknown } | undefined)?._tag === "PermissionNotFoundError";

const END_EVENTS = new Set<string>(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]);

export { DENIED } from "../port.js";

/**
 * An image as a file OpenCode reads and attaches. OpenCode 2.2 takes `file://` and
 * `data:` URIs (not bare paths; checked 2026-11-14) and reads the file itself, without
 * a permission request, though it is outside the session's folder.
 */
export const imageFile = (image: TurnImage): OpenCodeFile => ({ uri: pathToFileURL(image.path).href, name: image.name });

/** How long Stop waits for OpenCode to confirm the turn ended. */
const STOP_WAIT = Duration.seconds(5);

/** A request OpenCode waits on, and the session (the thread's, or a subagent's) that asked. */
type PendingRequest =
  | { readonly kind: "permission"; readonly sessionId: string }
  | { readonly kind: "form"; readonly sessionId: string; readonly event: Extract<OpenCodeEvent, { readonly type: "form.created" }> };

interface RunningTurn {
  readonly id: string;
  /** The message's inbox id, until OpenCode takes it. */
  inboxId: string | undefined;
  /** OpenCode started running it (`session.execution.started`). */
  started: boolean;
  /**
   * OpenCode started the turn by itself when subagents reported: the session's
   * watcher, which saw it start, passes its signals here.
   */
  readonly feed: Queue.Queue<OpenCodeSignal> | undefined;
}

/** A subagent of the session (a child session, or a child's child) as last reported. */
type Child = { -readonly [K in keyof SubagentState]: SubagentState[K] };

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
 * How long a turn OpenCode had no route for waits before each new attempt (10 s in
 * all); OpenCode saying its models changed cuts a wait short. No route costs nothing.
 */
export const ROUTE_BACKOFF: ReadonlyArray<Duration.Duration> = [1, 2, 3, 4].map((seconds) => Duration.seconds(seconds));

/**
 * OpenCode had no route to the model (`provider.no-route`). OpenCode 2.3.0 says so
 * for Copilot Auto when a turn arrives before Copilot's models have loaded for the
 * folder, about 3 seconds after its first use; a moment later the same turn works.
 * Its `model.updated` events don't say which provider loaded, so one can come and
 * the route still be missing: they only end a wait early.
 */
const unrouted = (event: OpenCodeEvent) =>
  event.type === "session.execution.failed" && (event.data.error as { readonly type?: unknown }).type === "provider.no-route";

/** Waits for OpenCode to say its models changed, or for `wait`; false when the server stopped. */
const modelsUpdatedOrAfter = (subscription: PubSub.Subscription<OpenCodeSignal>, wait: Duration.Input) =>
  Effect.gen(function* () {
    while (true) {
      const signal = yield* PubSub.take(subscription);
      if (signal._tag === "stopped") return false;
      if (signal._tag === "event" && signal.event.type === "model.updated") return true;
    }
  }).pipe(
    Effect.timeoutOption(wait),
    Effect.map((updated) => Option.getOrElse(updated, () => true)),
  );

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

const sessionRules = (setup: SessionSetup) =>
  permissionRules(setup.autonomy, setup.vaultTools === null ? null : revisedEntryName(setup.vaultTools), setup.attachmentFolders, setup.protection);
const rulesKey = (setup: SessionSetup) => JSON.stringify(sessionRules(setup));

export { vaultToolsUnavailable } from "../port.js";

/** Router providers' names, for a router OpenCode doesn't list (`github-copilot/auto` → Copilot Auto). */
const ROUTER_PROVIDERS: Readonly<Record<string, string>> = { "github-copilot": "Copilot" };

/** A model's name when OpenCode doesn't list it: a router's made from its provider, anything else its id. */
export const unlistedModelName = (model: string) => {
  if (!isRouter(model)) return model;
  const provider = model.slice(0, model.indexOf("/"));
  return `${ROUTER_PROVIDERS[provider] ?? provider} Auto`;
};

/** Ignores a failure of a best-effort call, logging it. */
const bestEffort = (what: string) => (effect: Effect.Effect<unknown, OpenCodeError>) =>
  effect.pipe(Effect.asVoid, Effect.catch((error) => Effect.logWarning(`OpenCode: ${what}: ${error.message}`)));

/** A session and what runs beside it: `watch` follows its subagents on one server, for as long as its scope. */
interface MadeSession {
  readonly session: ProviderSession;
  readonly watch: (api: OpenCodeApi) => Effect.Effect<void, never, Scope.Scope>;
}

const makeSession = (
  connect: Connect,
  sessionId: string,
  cwd: string,
  silence: Duration.Input,
  applied: Applied,
  fs: FileSystem.FileSystem,
  initialModel: string | null,
  background: Queue.Queue<BackgroundEvent>,
): MadeSession => {
  let turn: RunningTurn | undefined;
  const requests = new Map<string, PendingRequest>();
  /** The thread's model as last set; null for OpenCode's default. */
  let selectedModel = initialModel;
  /** The setup of the latest turn the app started: what subagents and turns OpenCode starts itself run under. */
  let latestSetup: SessionSetup | undefined;
  /** The latest turn, app's or OpenCode's; subagents launched between turns belong to it. */
  let lastTurnId: string | undefined;
  /** The session's subagents (children, and their children) seen in this run, by session id. */
  const children = new Map<string, Child>();
  /** Reports in the session's inbox that haven't started a turn yet, by inbox id. */
  const reports = new Map<string, SubagentReport>();
  /**
   * Stop pressed (it stops everything): until you send again, the subagents'
   * cancelled reports are withdrawn and any turn they start is stopped at once, so
   * the agent isn't woken. Checked live on 2.3.0 (2026-11-20).
   */
  let stopping = false;
  /**
   * The app's turn whose execution the watcher hasn't seen start (set again when it is
   * re-sent), kept after Stop. The watcher reads on a subscription of its own, so it
   * decides by itself: that turn's start is the app's; any other start OpenCode began.
   */
  let appStart: RunningTurn | undefined;

  const family = (id: string) => id === sessionId || children.has(id);
  const tell = (event: BackgroundEvent) => Queue.offer(background, event).pipe(Effect.asVoid);
  const report = (child: Child) => tell({ _tag: "subagent", state: { ...child } });

  /** The model this turn asked for: the thread's, or OpenCode's default (null if it can't say). */
  const turnModel = (api: OpenCodeApi) =>
    selectedModel !== null ? Effect.succeed(selectedModel) : api.defaultModel(cwd).pipe(Effect.catch(() => Effect.succeed(null)));

  /** Names a routed turn's models from OpenCode's list, asked for once per turn; ids stand in when it can't say. */
  const namer = (api: OpenCodeApi) => {
    let listed: ReadonlyMap<string, string> | undefined;
    return (event: ProviderEvent) =>
      Effect.gen(function* () {
        if (event._tag !== "model.routed") return event;
        listed ??= yield* api.listModels(cwd).pipe(
          Effect.map((models) => new Map(models.map((model) => [model.id, model.name]))),
          Effect.catch(() => Effect.succeed(new Map<string, string>())),
        );
        const name = (id: string) => listed?.get(id) ?? unlistedModelName(id);
        return { ...event, selected: { id: event.selected.id, name: name(event.selected.id) }, model: { id: event.model.id, name: name(event.model.id) } };
      });
  };

  /**
   * Registers the thread's vault tools with OpenCode when they are new, changed (a
   * new token), or on a new server (after a crash). OpenCode keeps an entry's first
   * tool list while its name stays registered, so a new set of tools from other MCP
   * servers comes under a new name (`revisedEntryName`) and the old entry is removed.
   * A failure leaves the turn to run without them; it returns why, for the user. The
   * token never goes in a log.
   */
  const applyTools = (api: OpenCodeApi, setup: SessionSetup) =>
    Effect.gen(function* () {
      const tools = setup.vaultTools;
      if (tools === null) return [];
      const name = revisedEntryName(tools);
      const key = `${name}\0${tools.url}\0${tools.token}`;
      if (applied.tools?.api === api && applied.tools.key === key) return [];
      const added = yield* Effect.result(api.addMcpServer(cwd, { name, url: tools.url, token: tools.token }));
      const rawReason = added._tag === "Failure" ? added.failure.message : added.success._tag === "failed" ? added.success.reason : undefined;
      const reason = rawReason?.replaceAll(tools.token, "[redacted]");
      const previous = applied.tools;
      // A failed entry is removed with the session and tried again next turn (its key never matches).
      applied.tools = { api, name, key: reason === undefined ? key : "" };
      // The old entry's token is revoked by now; it only lists stale tools.
      if (previous !== undefined && previous.api === api && previous.name !== name) {
        yield* api.removeMcpServer(cwd, previous.name).pipe(Effect.catch((error) => Effect.logWarning(`couldn't remove ${previous.name} from OpenCode: ${error.message}`)));
      }
      if (reason !== undefined) {
        yield* Effect.logWarning(`thread vault tools (${name}) not registered with OpenCode: ${reason}`);
        return [vaultToolsUnavailable(reason)];
      }
      return [];
    });

  /**
   * Brings the session's permissions, instructions and vault tools up to date with
   * `setup`; returns notices for the user. Subagents at work get the new rules too:
   * OpenCode copies the parent's rules into a child only when it creates it.
   */
  const apply = (api: OpenCodeApi, setup: SessionSetup) =>
    Effect.gen(function* () {
      const rules = rulesKey(setup);
      if (rules !== applied.rules) {
        yield* api.setPermissions(sessionId, sessionRules(setup));
        for (const child of children.values()) {
          if (isSubagentActive(child.status)) yield* bestEffort("updating a subagent's permissions")(api.setPermissions(child.subagentId, sessionRules(setup)));
        }
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
   * Answers a request on the app's own authority, in the session that asked. One
   * OpenCode no longer has is left be rather than failing the turn: seen live when
   * the model asked for several files at once and one was refused.
   */
  const answerItself = (api: OpenCodeApi, asker: string, requestId: string, reply: "once" | "reject", message?: string) =>
    api.replyPermission(asker, requestId, reply, message).pipe(
      Effect.catchIf(alreadySettled, () => Effect.void),
      Effect.mapError(toProviderError),
    );

  type AskedPermission = { readonly id: string; readonly sessionID: string; readonly action: string; readonly resources: ReadonlyArray<string> };

  /**
   * Refuses a request that reaches a protected file, whatever the rules let
   * through: a file action on one (for a search, a folder holding one counts), a
   * folder (`external_directory`) inside one, or a command naming one. A folder that
   * merely holds one is allowed: the file actions in it are still checked. True when
   * answered here.
   */
  const refuseSecret = (api: OpenCodeApi, setup: SessionSetup, request: AskedPermission) =>
    Effect.gen(function* () {
      const reaches =
        request.action === "shell"
          ? request.resources.some((command) => commandNamesProtected(setup.protection, command))
          : request.action === "external_directory" || FILE_ACTIONS.includes(request.action)
            ? yield* reachesProtected(setup.protection, cwd, request.resources, { searches: SEARCH_ACTIONS.includes(request.action) }).pipe(Effect.provideService(FileSystem.FileSystem, fs))
            : false;
      if (!reaches) return false;
      yield* answerItself(api, request.sessionID, request.id, "reject", SECRET_DENIED);
      return true;
    });

  /**
   * Answers a request OpenCode asked only because it might reach a protected name
   * (see `nameCheckRules`) and that `refuseSecret` let through: as the agent's rules
   * would have without the check. True when answered here; a request those rules ask
   * about goes on as usual.
   */
  const answerNameCheck = (api: OpenCodeApi, setup: SessionSetup, request: AskedPermission) =>
    Effect.gen(function* () {
      const level = levelBehindNameCheck(sessionRules(setup), setup.protection, request.action, request.resources);
      if (level === null || level === "ask") return false;
      yield* (level === "allow" ? answerItself(api, request.sessionID, request.id, "once") : answerItself(api, request.sessionID, request.id, "reject", DENIED));
      return true;
    });

  /**
   * OpenCode asks before the agent reaches outside the session's folder (the main
   * working directory). In a project thread, the project's other working directories
   * and the shared vault belong to it: allow those once, and the action itself then
   * follows the agent's autonomy like any other. Anywhere else goes to you. True when
   * answered here.
   */
  const answerInProject = (api: OpenCodeApi, setup: SessionSetup, request: AskedPermission) =>
    Effect.gen(function* () {
      if (setup.projectRoots === null || request.action !== "external_directory") return false;
      const inside = yield* pathsWithinRoots(setup.projectRoots, cwd, request.resources).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      if (!inside) return false;
      yield* answerItself(api, request.sessionID, request.id, "once");
      return true;
    });

  /** Answers a permission request the app settles itself (protected files, the project's folders); true when answered. */
  const settledByApp = (api: OpenCodeApi, setup: SessionSetup, request: AskedPermission) =>
    Effect.gen(function* () {
      if (yield* refuseSecret(api, setup, request)) return true;
      if (yield* answerNameCheck(api, setup, request)) return true;
      return yield* answerInProject(api, setup, request);
    });

  /**
   * Maps the events of one of the session's executions, from `next`, into `queue`
   * until it ends. `sendAgain` re-sends a turn OpenCode had no route for (false when
   * it can't); `progress.shown` says the turn showed something.
   */
  const follow = (
    queue: Queue.Queue<ProviderEvent, ProviderError | Cause.Done>,
    api: OpenCodeApi,
    current: RunningTurn,
    setup: SessionSetup,
    compacting: boolean,
    selected: string | null,
    next: (wait: Duration.Input) => Effect.Effect<Option.Option<OpenCodeSignal>>,
    sendAgain: Effect.Effect<boolean, ProviderError>,
    progress: { shown: boolean },
  ) =>
    Effect.gen(function* () {
      const turnId = current.id;
      const mapper = makeTurnMapper(turnId, cwd, { compacting, selectedModel: selected });
      const name = namer(api);
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
        const signal = yield* next(silence);
        if (Option.isSome(signal) && signal.value._tag === "stopped") {
          // OpenCode's pending approvals and questions went with it.
          for (const [id, request] of requests) if (request.sessionId === sessionId) requests.delete(id);
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
            if (yield* settledByApp(api, setup, event.data)) continue;
            requests.set(event.data.id, { kind: "permission", sessionId });
            waiting.add(event.data.id);
            break;
          case "form.created":
            requests.set(event.data.form.id, { kind: "form", sessionId, event });
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
        if (!current.started && (END_EVENTS.has(event.type) || event.type === "session.compaction.ended" || event.type === "session.compaction.failed")) continue;
        if (unrouted(event) && (yield* sendAgain)) continue;
        const events = yield* Effect.forEach(mapper.map(event), name);
        if (events.some((mapped) => mapped._tag === "turn.finished")) return yield* end(events);
        if (events.length > 0) progress.shown = true;
        yield* Queue.offerAll(queue, events);
      }
    });

  /**
   * Runs one of OpenCode's executions as the turn: `send` puts what starts it in the
   * session's inbox (a message, or a compaction) and returns its inbox id; the
   * session's events are mapped until the execution ends.
   */
  const execute = (
    turnId: string,
    setup: SessionSetup,
    send: (api: OpenCodeApi, notices: ReadonlyArray<string>) => Effect.Effect<string, OpenCodeError>,
    compacting: boolean,
  ) =>
    Stream.callback<ProviderEvent, ProviderError>((queue) =>
      Effect.gen(function* () {
        const api = yield* connect;
        // You sent again after a Stop: the agent may be woken by its subagents again.
        stopping = false;
        latestSetup = setup;
        lastTurnId = turnId;
        const notices = yield* apply(api, setup);
        yield* Queue.offerAll(queue, notices.map((text): ProviderEvent => ({ _tag: "notice", turnId, text })));
        // Subscribe before sending: OpenCode's stream is live only.
        const subscription = yield* api.subscribe;
        const current: RunningTurn = { id: turnId, inboxId: undefined, started: false, feed: undefined };
        turn = current;
        appStart = current;
        const selected = yield* turnModel(api);
        /** What was sent; a message's inbox id is also its id in the session's history. */
        let sentId = yield* send(api, notices).pipe(Effect.mapError(toProviderError));
        current.inboxId = sentId;
        const progress = { shown: false };
        let rerouted = 0;

        /**
         * The turn failed for want of a route before it showed anything: after the
         * next wait in `ROUTE_BACKOFF`, take the message out of the session and send
         * it again, so the model sees it once. False when it shouldn't or couldn't be
         * (the turn then fails with OpenCode's reason, as before).
         */
        const sendAgain = Effect.gen(function* () {
          const wait = ROUTE_BACKOFF[rerouted];
          if (progress.shown || compacting || wait === undefined) return false;
          if (!(yield* modelsUpdatedOrAfter(subscription, wait)) || turn !== current) return false;
          const removed = yield* api.removeMessage(sessionId, sentId).pipe(
            Effect.as(true),
            Effect.catch((error) => Effect.as(Effect.logWarning(`couldn't take the unrouted message out of OpenCode's session: ${error.message}`), false)),
          );
          if (!removed) return false;
          rerouted++;
          current.started = false;
          // Its new execution is still the app's turn.
          appStart = current;
          sentId = yield* send(api, notices).pipe(Effect.mapError(toProviderError));
          current.inboxId = sentId;
          return true;
        });

        yield* follow(queue, api, current, setup, compacting, selected, (wait) => nextSignal(subscription, sessionId, wait), sendAgain, progress);
      }),
    );

  /** A turn OpenCode started by itself (`current.feed` set by the watcher), mapped like any other. */
  const followTurn = (current: RunningTurn & { readonly feed: Queue.Queue<OpenCodeSignal> }, setup: SessionSetup) =>
    Stream.callback<ProviderEvent, ProviderError>((queue) =>
      Effect.gen(function* () {
        const api = yield* connect;
        const selected = yield* turnModel(api);
        const next = (wait: Duration.Input) => Queue.take(current.feed).pipe(Effect.timeoutOption(wait), Effect.catchCause(() => Effect.succeedNone));
        yield* follow(queue, api, current, setup, false, selected, next, Effect.succeed(false), { shown: false });
      }),
    );

  const startTurn = ({ turnId, text, images, setup }: TurnInput) =>
    execute(
      turnId,
      setup,
      (api, notices) => api.prompt(sessionId, notices.length ? `${text}\n\nApp notices for this turn:\n${notices.join("\n")}` : text, images.map(imageFile)),
      false,
    );

  /** OpenCode admits the compaction to the session's inbox and runs it as an execution of its own (checked on 2.2.6). */
  const compact = ({ turnId, setup }: CompactInput) => execute(turnId, setup, (api) => api.compact(sessionId), true);

  /** Closes the requests a subagent was waiting on: OpenCode no longer waits for them. */
  const closeRequestsOf = (child: Child) =>
    Effect.gen(function* () {
      for (const [id, request] of [...requests]) {
        if (request.sessionId !== child.subagentId) continue;
        requests.delete(id);
        yield* tell({ _tag: "request.closed", requestId: id });
      }
    });

  /**
   * Stop stops everything: every subagent at work, so nothing wakes the agent again
   * (their reports are withdrawn while `stopping`), then whatever the caller stops.
   */
  const stopSubagents = (api: OpenCodeApi) =>
    Effect.gen(function* () {
      stopping = true;
      // Taken first: their states change as the watcher hears of the first stops.
      const working = [...children.values()].filter((child) => isSubagentActive(child.status));
      for (const child of working) yield* bestEffort("stopping a subagent")(api.interrupt(child.subagentId));
    });

  /**
   * Stops the turn. Straight after Send, OpenCode may not have started it yet, and
   * its interrupt does nothing then: withdraw the message if it is still queued,
   * otherwise wait for the turn to start and stop it. Returns once OpenCode has
   * confirmed, or after a few seconds. Every subagent is stopped first.
   */
  const interrupt = (turnId: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const api = yield* connect;
        if (yield* api.isStopped) return;
        yield* stopSubagents(api);
        const current = turn;
        if (current === undefined || current.id !== turnId) {
          // A turn OpenCode began after the one asked about, or nothing the session knows: stop whatever runs.
          if (yield* api.isRunning(sessionId)) yield* bestEffort("stopping the agent")(api.interrupt(sessionId));
          return;
        }
        turn = undefined;
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
          if (withdrawn && !(yield* api.isRunning(sessionId))) {
            // It will never start.
            if (appStart === current) appStart = undefined;
            return;
          }
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

  /** Stop with no turn running: every subagent, and a turn their reports may have started. */
  const stopBackground = Effect.gen(function* () {
    const api = yield* connect;
    if (yield* api.isStopped) return;
    yield* stopSubagents(api);
    if (yield* api.isRunning(sessionId).pipe(Effect.catch(() => Effect.succeed(false)))) yield* bestEffort("stopping the agent")(api.interrupt(sessionId));
  }).pipe(Effect.catch((error) => Effect.logWarning("OpenCode didn't confirm the stop", error)));

  const answerRequest = (requestId: string, answer: RequestAnswer) =>
    Effect.gen(function* () {
      const request = requests.get(requestId);
      if (request === undefined) return yield* new ProviderError({ message: "OpenCode is no longer waiting for this answer." });
      requests.delete(requestId);
      const api = yield* connect;
      if (request.kind === "permission") {
        const approved = answer._tag === "approval" && answer.decision === "approve";
        return yield* (approved ? api.replyPermission(request.sessionId, requestId, "once") : api.replyPermission(request.sessionId, requestId, "reject", DENIED)).pipe(
          Effect.mapError(toProviderError),
        );
      }
      const text = answer._tag === "question" ? answer.text : "";
      return yield* api.replyForm(request.sessionId, requestId, formAnswer(request.event, text)).pipe(Effect.mapError(toProviderError));
    });

  /** OpenCode started a turn on the agent by itself (subagents reported): hand it to the app as a turn of its own. */
  const startedByOpenCode = (api: OpenCodeApi) =>
    Effect.gen(function* () {
      const setup = latestSetup;
      if (stopping || setup === undefined) {
        // After Stop, nothing may wake the agent; without a turn of this run there's nothing to run it under.
        yield* bestEffort("stopping the agent")(api.interrupt(sessionId));
        return;
      }
      const feed = yield* Queue.unbounded<OpenCodeSignal>();
      const current = { id: randomUUID(), inboxId: undefined, started: true, feed };
      turn = current;
      lastTurnId = current.id;
      const reported = [...reports.values()];
      reports.clear();
      yield* tell({ _tag: "turn", turnId: current.id, reports: reported, events: followTurn(current, setup) });
    });

  /** One of a subagent's own events: its requests, and how it runs. */
  const onChild = (api: OpenCodeApi, child: Child, event: OpenCodeEvent) =>
    Effect.gen(function* () {
      const asking = (status: Child["status"]) =>
        Effect.gen(function* () {
          child.status = status;
          yield* report(child);
        });
      switch (event.type) {
        case "permission.asked": {
          if (latestSetup !== undefined && (yield* settledByApp(api, latestSetup, event.data).pipe(Effect.catch(() => Effect.succeed(false))))) return;
          requests.set(event.data.id, { kind: "permission", sessionId: child.subagentId });
          yield* asking("waiting");
          return yield* tell({ _tag: "request.opened", turnId: child.turnId, subagentId: child.subagentId, requestId: event.data.id, prompt: approvalPrompt(event) });
        }
        case "form.created":
          requests.set(event.data.form.id, { kind: "form", sessionId: child.subagentId, event });
          yield* asking("waiting");
          return yield* tell({ _tag: "request.opened", turnId: child.turnId, subagentId: child.subagentId, requestId: event.data.form.id, prompt: questionPrompt(event) });
        case "permission.replied":
        case "form.replied":
        case "form.cancelled": {
          const id = event.type === "permission.replied" ? event.data.requestID : event.data.id;
          // Answered through the app, it was taken out already; otherwise OpenCode settled it.
          if (requests.delete(id)) yield* tell({ _tag: "request.closed", requestId: id });
          const stillAsking = [...requests.values()].some((request) => request.sessionId === child.subagentId);
          if (child.status === "waiting" && !stillAsking) yield* asking("running");
          return;
        }
        case "session.execution.started":
          if (child.status !== "running" && child.status !== "waiting") yield* asking("running");
          return;
        case "session.execution.failed":
          child.result = event.data.error.message;
          yield* closeRequestsOf(child);
          return yield* asking("failed");
        case "session.execution.interrupted":
          yield* closeRequestsOf(child);
          return yield* asking("cancelled");
        // A child going idle is reported by its report to its parent, with the result.
      }
    });

  /** The parent session's events: OpenCode starting a turn by itself, and that turn's events. */
  const onParent = (api: OpenCodeApi, event: OpenCodeEvent) =>
    Effect.gen(function* () {
      if (event.type === "session.inbox.delivered" || event.type === "session.inbox.cancelled") reports.delete(event.data.inboxID);
      const current = turn;
      if (event.type === "session.execution.started") {
        // The app's turn starting (its own subscription follows it, or it was stopped), however far that has read.
        if (appStart !== undefined) {
          appStart = undefined;
          return;
        }
        // Otherwise OpenCode began this itself, even if the app's turn hasn't read its own end yet.
        return yield* startedByOpenCode(api);
      }
      // A turn OpenCode started reads the watcher's events; the app's own turns subscribe themselves.
      if (current?.feed !== undefined) yield* Queue.offer(current.feed, { _tag: "event", event });
    });

  /**
   * The event stream reconnected: what it missed while down is lost, so ask OpenCode
   * how the session's subagents stand. A subagent shown at work that has since gone
   * idle gets the state its last run ended with (its report is lost, so its result
   * stays as last seen), and its requests close; one shown idle that runs again is
   * at work; one launched while the stream was down and still at work is added.
   * Idle subagents the app doesn't know are from earlier runs and are left out.
   */
  const reconcile = (api: OpenCodeApi) =>
    Effect.gen(function* () {
      const parents = [sessionId];
      for (let parentId = parents.shift(); parentId !== undefined; parentId = parents.shift()) {
        for (const listed of yield* api.listChildren(parentId)) {
          let child = children.get(listed.id);
          if (child === undefined) {
            const launcher = children.get(parentId)?.turnId ?? turn?.id ?? lastTurnId;
            if (!listed.running || launcher === undefined) continue;
            child = { turnId: launcher, subagentId: listed.id, label: listed.title ?? "Subagent", agent: listed.agent, status: "running", result: null };
            children.set(child.subagentId, child);
            yield* report(child);
          } else if (listed.running && !isSubagentActive(child.status)) {
            child.status = "running";
            yield* report(child);
          } else if (!listed.running && isSubagentActive(child.status) && listed.outcome !== null) {
            child.status = listed.outcome === "succeeded" ? "done" : listed.outcome === "interrupted" ? "cancelled" : "failed";
            yield* closeRequestsOf(child);
            yield* report(child);
          }
          if (listed.running && stopping) yield* bestEffort("stopping a subagent")(api.interrupt(child.subagentId));
          parents.push(child.subagentId);
        }
      }
    });

  /** Follows the session's subagents on `api`, and the turns OpenCode starts itself, until the scope closes. */
  const watch = (api: OpenCodeApi) =>
    Effect.gen(function* () {
      const subscription = yield* api.subscribe;
      const handle = (event: OpenCodeEvent) =>
        Effect.gen(function* () {
          const created = childCreated(event);
          if (created !== undefined) {
            if (!family(created.parentId)) return;
            const launcher = children.get(created.parentId)?.turnId ?? turn?.id ?? lastTurnId;
            if (launcher === undefined) return;
            const child: Child = { turnId: launcher, subagentId: created.childId, label: created.label, agent: created.agent, status: "running", result: null };
            children.set(child.subagentId, child);
            yield* report(child);
            if (stopping) yield* bestEffort("stopping a subagent")(api.interrupt(child.subagentId));
            return;
          }
          const from = sessionOf(event);
          if (from === undefined || !family(from)) return;
          const reported = childReport(event);
          if (reported !== undefined) {
            const child = children.get(reported.childId);
            if (child !== undefined) {
              child.status = reported.status;
              child.result = reported.result;
              if (!isSubagentActive(child.status)) yield* closeRequestsOf(child);
              yield* report(child);
            }
            if (from === sessionId) {
              if (stopping) yield* bestEffort("withdrawing a subagent's report")(api.cancelPrompt(sessionId, reported.inboxId));
              else if (child !== undefined) reports.set(reported.inboxId, { subagentId: child.subagentId, label: child.label, status: child.status });
            }
            if (from === sessionId) return yield* onParent(api, event);
            return;
          }
          if (from === sessionId) return yield* onParent(api, event);
          const child = children.get(from);
          if (child !== undefined) yield* onChild(api, child, event);
        });
      while (true) {
        const signal = yield* PubSub.take(subscription);
        if (signal._tag === "event") {
          yield* handle(signal.event).pipe(Effect.catchCause((cause) => Effect.logWarning("OpenCode: following subagents", cause)));
          continue;
        }
        if (turn?.feed !== undefined) yield* Queue.offer(turn.feed, signal);
        if (signal._tag === "reconnected") {
          // Events that arrive meanwhile wait in the subscription, so none is handled out of turn.
          yield* reconcile(api).pipe(Effect.catchCause((cause) => Effect.logWarning("OpenCode: checking subagents after a reconnect", cause)));
          continue;
        }
        if (signal._tag === "stopped") {
          // The subagents ran in that server: what they were doing is unknown now.
          for (const child of children.values()) {
            if (!isSubagentActive(child.status)) continue;
            yield* closeRequestsOf(child);
            child.status = "interrupted";
            yield* report(child);
          }
          reports.clear();
          return;
        }
      }
    }).pipe(Effect.interruptible);

  const session: ProviderSession = {
    nativeSessionId: sessionId,
    startTurn,
    compact,
    // OpenCode runs inside this server; when it stops, OpenCode cancels the turn and
    // its pending approvals, so there is nothing to resume.
    resumeTurn: () => Effect.succeed(Option.none()),
    interrupt,
    background: Stream.fromQueue(background),
    stopBackground,
    answerRequest,
    setModel: (model) =>
      Effect.flatMap(connect, (api) =>
        api.switchModel(sessionId, model).pipe(
          Effect.mapError(toProviderError),
          Effect.tap(() =>
            Effect.sync(() => {
              selectedModel = model;
            }),
          ),
        ),
      ),
  };
  return { session, watch };
};

/**
 * OpenCode 2. One `opencode serve` is shared by every thread: it starts with the
 * first session and stops after `idleTime` with none. Each thread is an OpenCode
 * session in the thread's working directory, kept on the thread and continued
 * after a restart. Its subagents (OpenCode 2.3's background `subagent` tool) are
 * child sessions, followed while the session is open.
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
        return { _tag: "unavailable", reason: `OpenCode ${installed} is installed; this app supports ${supportedVersionsText()}.` } as const;
      }
      const api = yield* Effect.scoped(live);
      return { _tag: "ready", version: api.version, account: null } as const;
    }).pipe(Effect.catch((error) => Effect.succeed({ _tag: "unavailable", reason: error.message } as const)));

    const adapter: ProviderAdapter = {
      kind: "opencode",
      capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true, compact: true },
      enforcement: enforcedAutonomy,
      openSession: ({ cwd, nativeSessionId, model, setup }) =>
        Effect.gen(function* () {
          // The session holds one server at a time, in a scope of its own inside the
          // session's, swapped for a new server when the held one has stopped. Its
          // subagents are followed on the held server, for as long as it is held.
          const sessionScope = yield* Effect.scope;
          let held: { readonly api: OpenCodeApi; readonly scope: Scope.Closeable } | undefined;
          let watch: MadeSession["watch"] | undefined;
          const connect: Connect = Effect.gen(function* () {
            if (held !== undefined && !(yield* held.api.isStopped)) return held.api;
            if (held !== undefined) yield* Scope.close(held.scope, Exit.void);
            const scope = yield* Scope.fork(sessionScope);
            const api = yield* live.pipe(Scope.provide(scope));
            held = { api, scope };
            if (watch !== undefined) yield* watch(api).pipe(Scope.provide(scope), Effect.forkIn(scope));
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
          let sessionId: string;
          if (existing && nativeSessionId !== null) {
            // The session keeps the rules it was made with; bring them up to date.
            yield* api.setPermissions(nativeSessionId, rules).pipe(Effect.mapError(toProviderError));
            sessionId = nativeSessionId;
          } else {
            sessionId = yield* api.createSession({ directory: cwd, model, permissions: rules }).pipe(Effect.mapError(toProviderError));
          }
          const background = yield* Effect.acquireRelease(Queue.unbounded<BackgroundEvent>(), Queue.shutdown);
          const made = makeSession(connect, sessionId, cwd, silence, applied, fs, model, background);
          watch = made.watch;
          // The first server was connected before the session existed.
          if (held !== undefined) yield* made.watch(held.api).pipe(Scope.provide(held.scope), Effect.forkIn(held.scope));
          return made.session;
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
