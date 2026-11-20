import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenCodeEvent } from "@opencode/protocol/groups/event";
import { Deferred, Effect, Fiber, PubSub, Schema } from "effect";
import type {
  OpenCodeApi,
  OpenCodeChildSession,
  OpenCodeFile,
  OpenCodeMcpStatus,
  OpenCodeModel,
  OpenCodeOutcome,
  OpenCodePermissionRule,
  OpenCodeSignal,
} from "../../../src/features/providers/opencode/api.js";
import { OpenCodeError } from "../../../src/features/providers/opencode/api.js";
import { attachmentsRootIn } from "../csv.js";
import { ATTACHMENTS, type FixtureImage, sha256 } from "../image.js";
import { type Fixture, type FixtureStep, VAULT } from "./fixture.js";
import { ruleEffect } from "../../../src/features/providers/opencode/permissions.js";
import { sessionOf } from "../../../src/features/providers/opencode/events.js";

const decodeEvent = Schema.decodeUnknownSync(OpenCodeEvent);

/**
 * The images behind `files`, as OpenCode would read them (only `file://` URIs, the
 * form the adapter sends), by name and hash: OpenCode finds the type itself.
 */
const sentImages = (files: ReadonlyArray<OpenCodeFile>) =>
  JSON.stringify(
    files.map((file) => {
      if (!file.uri.startsWith("file://")) throw new Error(`the adapter sent ${file.uri.slice(0, 40)}, not a file:// URI`);
      return { name: file.name ?? "", sha256: sha256(readFileSync(fileURLToPath(file.uri))) };
    }),
  );
const recordedImages = (images: ReadonlyArray<FixtureImage> = []) => JSON.stringify(images.map(({ name, sha256 }) => ({ name, sha256 })));

export const loadFixture = (scenario: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./${scenario}.json`, import.meta.url), "utf8")) as Fixture;

export const FAKE_MODELS: ReadonlyArray<OpenCodeModel> = [
  { id: "opencode/big-pickle", name: "Big Pickle", free: true, images: false },
  { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5", free: false, images: true },
];

export interface PlayOptions {
  /** Explicit app context expected after each recorded prompt. */
  readonly promptSuffixes?: ReadonlyArray<string>;
  /** Hold the turn before OpenCode starts it, until `release` (to press Stop in between). */
  readonly holdStart?: boolean;
  /** Stop publishing after this many events, as if the stream lost the rest; the turn still runs to its end. */
  readonly loseAfter?: number;
  /** Events the stream loses (it reconnects with `reconnect`); they still happen, and `listChildren` tells of them. */
  readonly lose?: (event: OpenCodeEvent) => boolean;
  /**
   * The thread's session from the last load goes on with this recording (a restart, a
   * crash): it keeps that session's id. Otherwise each load is a new session, with an
   * id of its own.
   */
  readonly continues?: boolean;
  /** What `listModels` answers instead of `FAKE_MODELS`. */
  readonly models?: ReadonlyArray<OpenCodeModel>;
}

/** What the adapter asked of OpenCode, in order. */
export type FakeCall =
  | { readonly call: "createSession"; readonly model: string | null; readonly permissions: ReadonlyArray<OpenCodePermissionRule> }
  | { readonly call: "prompt"; readonly text: string; readonly files?: ReadonlyArray<OpenCodeFile> }
  | { readonly call: "cancelPrompt" | "interrupt" | "compact" | "listChildren" }
  | { readonly call: "removeMessage"; readonly messageId: string }
  | { readonly call: "setPermissions"; readonly permissions: ReadonlyArray<OpenCodePermissionRule> }
  | { readonly call: "setInstructions"; readonly text: string | null }
  | { readonly call: "reply"; readonly requestId: string; readonly reply: string; readonly message?: string }
  | { readonly call: "switchModel"; readonly model: string }
  | { readonly call: "addMcpServer"; readonly directory: string; readonly name: string; readonly url: string; readonly token: string }
  | { readonly call: "removeMcpServer"; readonly directory: string; readonly name: string };

/** One recorded conversation being played, as one OpenCode session. */
interface Session {
  readonly fixture: Fixture;
  readonly directory: string;
  readonly options: PlayOptions;
  /** Request ids get this suffix, as a real OpenCode never repeats one; new with every load. */
  readonly suffix: string;
  /** Session ids get this one: new with every load, unless it continues the last (`continues`). */
  readonly sessionSuffix: string;
  created: boolean;
  turn: number;
  running: boolean;
  outcome: OpenCodeOutcome | null;
  playback: Fiber.Fiber<void> | undefined;
  stopPressed: Deferred.Deferred<void> | undefined;
  startGate: Deferred.Deferred<void> | undefined;
  /** Done once the adapter has sent this session's next prompt. */
  prompted: Deferred.Deferred<void>;
  /** The session's permission rules, as the adapter last set them. */
  rules: ReadonlyArray<OpenCodePermissionRule>;
  /** Where the turn being played keeps its attachments (recorded as `ATTACHMENTS`). */
  attachments: string | undefined;
  /** The subagents played so far, by live id, with their parents, as `listChildren` lists them. */
  readonly children: Map<string, OpenCodeChildSession & { readonly parentId: string }>;
}

/**
 * An OpenCode server that plays recorded fixtures, one per session: each prompt
 * plays the session's next recorded turn, pausing at a request until the adapter
 * answers it (with the answer that was recorded) and at a recorded Stop until the
 * adapter presses it. A recorded ask to reach a folder outside the session's
 * (`external_directory`) is skipped when the session's rules allow it, as OpenCode
 * does, so recordings made with the default rules play under narrower ones. `load` starts over with one fixture between tests, `add`
 * plays another at the same time; `createSession` hands them out in that order.
 * The API object stays the same, as the adapter keeps it for the server's lifetime.
 */
export const makeFakeOpenCode = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const hub = yield* PubSub.unbounded<OpenCodeSignal>();
  const calls: Array<FakeCall> = [];
  /** Tests waiting for the adapter to have made a call so many times (`made`). */
  const waiters: Array<{ readonly call: FakeCall["call"]; readonly times: number; readonly done: Deferred.Deferred<void> }> = [];
  const note = (call: FakeCall) => {
    calls.push(call);
    const made = (name: FakeCall["call"]) => calls.filter((each) => each.call === name).length;
    for (const waiter of waiters) if (made(waiter.call) >= waiter.times) Deferred.doneUnsafe(waiter.done, Effect.void);
  };
  const sessions = new Map<string, Session>();
  /** The server crashed (`crash`) and hasn't been started again. */
  let stopped = false;
  let starts = 0;
  let loads = 0;
  /** The suffix each recorded session id last had, for `continues`. */
  const suffixes = new Map<string, string>();
  const replies = new Map<string, Deferred.Deferred<string>>();
  /** What adding an MCP server reports; `failMcp` makes OpenCode refuse it. */
  let mcp: OpenCodeMcpStatus | "refused" = { _tag: "connected" };

  /**
   * The session's id as the adapter sees it: the recorded one with the session's
   * suffix, so a thread left from an earlier load never takes this one's events as its own.
   */
  const liveId = (session: Session) => `${session.fixture.sessionId}${session.sessionSuffix}`;
  /** The live ids of the session's subagents (child sessions) in its recording. */
  const childIds = (session: Session) =>
    session.fixture.turns.flatMap((turn) =>
      turn.steps.flatMap((step) => {
        const event = "event" in step ? (step.event as { readonly type?: string; readonly data?: { readonly sessionID?: string; readonly parentID?: string } }) : undefined;
        return event?.type === "session.created" && event.data?.parentID !== undefined && event.data.sessionID !== undefined ? [`${event.data.sessionID}${session.sessionSuffix}`] : [];
      }),
    );
  /** A session by its live id, by its recorded id (tests ask by that), or by one of its subagents' ids. */
  const find = (sessionId: string) =>
    sessions.get(sessionId) ??
    [...sessions.values()].find((session) => liveId(session) === sessionId) ??
    [...sessions.values()].find((session) => childIds(session).includes(sessionId));
  /** `sessionId` is one of a session's subagents, not the session itself. */
  const isChild = (session: Session, sessionId: string) => sessionId !== liveId(session) && sessionId !== session.fixture.sessionId;

  const sessionFor = (sessionId: string) => {
    const session = find(sessionId);
    if (session === undefined) throw new Error(`no fixture loaded for session ${sessionId}`);
    return session;
  };

  const replyFor = Effect.fnUntraced(function* (requestId: string) {
    const existing = replies.get(requestId);
    if (existing !== undefined) return existing;
    const created = yield* Deferred.make<string>();
    replies.set(requestId, created);
    return created;
  });

  const requestIds = (session: Session, text: string) =>
    text.replace(/\b(per|frm)_[A-Za-z0-9]+/g, (id) => `${id}${session.suffix}`).replace(/\bses_[A-Za-z0-9]+/g, (id) => `${id}${session.sessionSuffix}`);
  const toEvent = (session: Session, raw: unknown) => {
    const text = requestIds(session, JSON.stringify(raw)).replaceAll(VAULT, session.directory);
    return decodeEvent(JSON.parse(session.attachments === undefined ? text : text.replaceAll(ATTACHMENTS, session.attachments)));
  };

  /** OpenCode doesn't ask what the session's rules already allow. */
  const allowedByRules = (session: Session, event: ReturnType<typeof decodeEvent>) =>
    event.type === "permission.asked" &&
    event.data.action === "external_directory" &&
    event.data.resources.every((resource) => ruleEffect(session.rules, "external_directory", resource) === "allow");

  /** Keeps what `listChildren` says of the session's subagents up to date with a played event. */
  const trackChild = (session: Session, event: ReturnType<typeof decodeEvent>) => {
    if (event.type === "session.created" && event.data.parentID !== undefined) {
      session.children.set(event.data.sessionID, {
        id: event.data.sessionID,
        parentId: event.data.parentID,
        title: event.data.title ?? null,
        agent: event.data.agent ?? null,
        running: false,
        outcome: null,
      });
      return;
    }
    const from = sessionOf(event);
    const child = from === undefined ? undefined : session.children.get(from);
    if (child === undefined) return;
    if (event.type === "session.execution.started") session.children.set(child.id, { ...child, running: true });
    if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
      const outcome = event.type === "session.execution.succeeded" ? "succeeded" : event.type === "session.execution.failed" ? "failed" : "interrupted";
      session.children.set(child.id, { ...child, running: false, outcome });
    }
  };

  const play = (session: Session, steps: ReadonlyArray<FixtureStep>) =>
    Effect.gen(function* () {
      let published = 0;
      const skipped = new Set<string>();
      for (const [index, step] of steps.entries()) {
        if ("call" in step) {
          if (step.call === "interrupt") yield* Deferred.await(session.stopPressed ?? (yield* Deferred.make<void>()));
          continue;
        }
        const event = toEvent(session, step.event);
        if (event.type === "permission.asked" && allowedByRules(session, event)) {
          skipped.add(event.data.id);
          continue;
        }
        if (event.type === "permission.replied" && skipped.has(event.data.requestID)) continue;
        if (event.type === "session.execution.started" && session.startGate !== undefined) yield* Deferred.await(session.startGate);
        trackChild(session, event);
        if (event.type === "session.execution.started") session.running = true;
        if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
          session.running = false;
          session.outcome =
            event.type === "session.execution.succeeded" ? "succeeded" : event.type === "session.execution.failed" ? "failed" : "interrupted";
        }
        const lost = session.options.lose?.(event) === true || (session.options.loseAfter !== undefined && published >= session.options.loseAfter);
        if (!lost) {
          yield* PubSub.publish(hub, { _tag: "event", event });
          published++;
        }
        const requestId = event.type === "permission.asked" ? event.data.id : event.type === "form.created" ? event.data.form.id : undefined;
        if (requestId !== undefined) {
          const recorded = steps
            .slice(index + 1)
            .find((next) => "call" in next && next.call === "reply" && requestIds(session, next.requestId) === requestId);
          const answer = yield* Deferred.await(yield* replyFor(requestId));
          if (recorded !== undefined && "reply" in recorded && recorded.reply !== answer) {
            return yield* Effect.die(new Error(`fixture answered ${requestId} with ${recorded.reply}, the adapter with ${answer}`));
          }
        }
      }
    });

  /** Plays a turn's steps in the background, as OpenCode runs what was put in the inbox; returns its inbox id. */
  const startPlaying = (session: Session, steps: ReadonlyArray<FixtureStep>) =>
    Effect.gen(function* () {
      session.stopPressed = yield* Deferred.make<void>();
      session.startGate = session.options.holdStart === true ? yield* Deferred.make<void>() : undefined;
      session.running = session.options.holdStart !== true;
      session.playback = yield* play(session, steps).pipe(Effect.forkIn(scope));
      yield* Deferred.succeed(session.prompted, undefined);
      const compacted = steps.find((step) => "call" in step && step.call === "compact");
      if (compacted !== undefined && "inboxId" in compacted) return compacted.inboxId;
      const enqueued = steps
        .map((step) => ("event" in step ? toEvent(session, step.event) : undefined))
        .find((event) => event?.type === "session.inbox.enqueued");
      return enqueued?.type === "session.inbox.enqueued" ? (enqueued.data.inboxID as string) : "msg_fake";
    });

  const stopPlayback = (session: Session) => (session.playback === undefined ? Effect.void : Fiber.interrupt(session.playback));

  const api: OpenCodeApi = {
    get version() {
      return [...sessions.values()][0]?.fixture.opencodeVersion ?? "2.2.1";
    },
    isStopped: Effect.sync(() => stopped),
    subscribe: PubSub.subscribe(hub),
    createSession: ({ model, permissions }) =>
      Effect.sync(() => {
        note({ call: "createSession", model, permissions });
        const next = [...sessions.values()].find((session) => !session.created);
        if (next === undefined) throw new Error("no fixture left for a new session");
        next.created = true;
        next.rules = permissions;
        return liveId(next);
      }),
    setPermissions: (sessionId, permissions) =>
      Effect.sync(() => {
        note({ call: "setPermissions", permissions });
        const session = find(sessionId);
        if (session !== undefined) session.rules = permissions;
      }),
    setInstructions: (_sessionId, text) =>
      Effect.sync(() => {
        note({ call: "setInstructions", text });
      }),
    sessionExists: (sessionId) => Effect.sync(() => find(sessionId) !== undefined),
    compact: (sessionId) =>
      Effect.gen(function* () {
        note({ call: "compact" });
        const session = sessionFor(sessionId);
        const turn = session.fixture.turns[session.turn++];
        if (turn === undefined) return yield* Effect.die(new Error(`fixture ${session.fixture.scenario} has no turn ${session.turn}`));
        if (turn.compact !== true) return yield* Effect.die(new Error(`fixture turn ${session.turn} was the prompt "${turn.prompt}", the adapter compacted`));
        return yield* startPlaying(session, turn.steps);
      }),
    prompt: (sessionId, text, files = []) =>
      Effect.gen(function* () {
        note({ call: "prompt", text, ...(files.length === 0 ? {} : { files }) });
        const session = sessionFor(sessionId);
        const turn = session.fixture.turns[session.turn++];
        if (turn === undefined) return yield* Effect.die(new Error(`fixture ${session.fixture.scenario} has no turn ${session.turn}`));
        if (turn.compact === true) return yield* Effect.die(new Error(`fixture turn ${session.turn} was a compaction, the adapter sent "${text}"`));
        const recordedPrompt = turn.prompt + (session.options.promptSuffixes?.[session.turn - 1] ?? "");
        session.attachments = attachmentsRootIn(recordedPrompt, text);
        const expectedPrompt = session.attachments === undefined ? recordedPrompt : recordedPrompt.replaceAll(ATTACHMENTS, session.attachments);
        if (expectedPrompt !== text) return yield* Effect.die(new Error(`fixture prompt was "${turn.prompt}", the adapter sent "${text}"`));
        const [sent, recorded] = [sentImages(files), recordedImages(turn.images)];
        if (sent !== recorded) return yield* Effect.die(new Error(`fixture images were ${recorded}, the adapter sent ${sent}`));
        return yield* startPlaying(session, turn.steps);
      }),
    removeMessage: (_sessionId, messageId) =>
      Effect.sync(() => {
        note({ call: "removeMessage", messageId });
      }),
    // Withdrawing works while the turn is held before it starts; once OpenCode has
    // taken the message it still says yes, and the turn runs anyway (as recorded).
    cancelPrompt: (sessionId) =>
      Effect.gen(function* () {
        note({ call: "cancelPrompt" });
        const session = sessionFor(sessionId);
        if (session.startGate !== undefined && !(yield* Deferred.isDone(session.startGate))) yield* stopPlayback(session);
      }),
    interrupt: (sessionId) =>
      Effect.gen(function* () {
        note({ call: "interrupt" });
        const session = sessionFor(sessionId);
        // Stopping a subagent is a recorded Stop too, whether or not the agent itself runs.
        if (session.stopPressed === undefined || (!session.running && !isChild(session, sessionId))) return false;
        yield* Deferred.succeed(session.stopPressed, undefined);
        return true;
      }),
    isRunning: (sessionId) => Effect.sync(() => find(sessionId)?.running ?? false),
    lastOutcome: (sessionId) => Effect.sync(() => find(sessionId)?.outcome ?? null),
    listChildren: (parentId) =>
      Effect.sync(() => {
        note({ call: "listChildren" });
        const session = find(parentId);
        if (session === undefined) return [];
        // Newest first, as OpenCode lists them.
        return [...session.children.values()]
          .filter((child) => child.parentId === parentId)
          .reverse()
          .map(({ parentId: _, ...child }) => child);
      }),
    replyPermission: (_sessionId, requestId, reply, message) =>
      Effect.gen(function* () {
        note({ call: "reply", requestId, reply, ...(message === undefined ? {} : { message }) });
        yield* Deferred.succeed(yield* replyFor(requestId), reply);
      }),
    replyForm: (_sessionId, formId, answer) =>
      Effect.gen(function* () {
        const text = Object.values(answer)[0] ?? "";
        note({ call: "reply", requestId: formId, reply: text });
        yield* Deferred.succeed(yield* replyFor(formId), text);
      }),
    listModels: () => Effect.sync(() => [...sessions.values()][0]?.options.models ?? FAKE_MODELS),
    defaultModel: () => Effect.sync(() => [...sessions.values()][0]?.fixture.model ?? null),
    switchModel: (_sessionId, model) =>
      Effect.sync(() => {
        note({ call: "switchModel", model });
      }),
    addMcpServer: (directory, server) =>
      Effect.suspend(() => {
        note({ call: "addMcpServer", directory, name: server.name, url: server.url, token: server.token });
        return mcp === "refused" ? Effect.fail(new OpenCodeError({ message: "OpenCode didn't take the vault tools (InvalidRequestError)." })) : Effect.succeed(mcp);
      }),
    removeMcpServer: (directory, name) =>
      Effect.sync(() => {
        note({ call: "removeMcpServer", directory, name });
      }),
  };

  const add = (fixture: Fixture, directory: string, options: PlayOptions = {}) =>
    Effect.gen(function* () {
      const existing = sessions.get(fixture.sessionId);
      if (existing !== undefined) yield* stopPlayback(existing);
      const suffix = `x${++loads}`;
      // Replacing a session's recording, or continuing it, keeps its id.
      const sessionSuffix = existing?.sessionSuffix ?? (options.continues === true ? suffixes.get(fixture.sessionId) : undefined) ?? suffix;
      suffixes.set(fixture.sessionId, sessionSuffix);
      sessions.set(fixture.sessionId, {
        fixture,
        directory,
        options,
        suffix,
        sessionSuffix,
        created: false,
        turn: 0,
        running: false,
        outcome: null,
        playback: undefined,
        stopPressed: undefined,
        startGate: undefined,
        prompted: yield* Deferred.make<void>(),
        rules: [],
        attachments: undefined,
        children: new Map(),
      });
    });

  return {
    api,
    calls,
    /** Starts the server (the adapter's `start`); counted, and undoes a crash. */
    start: Effect.sync(() => {
      stopped = false;
      starts++;
      return api;
    }),
    starts: () => starts,
    /** As if the OpenCode process died: every turn, approval, and question goes with it. */
    crash: Effect.gen(function* () {
      stopped = true;
      for (const session of sessions.values()) {
        session.running = false;
        yield* stopPlayback(session);
      }
      yield* PubSub.publish(hub, { _tag: "stopped" });
    }),
    /** Starts over with `fixture` alone, with recorded paths moved to `directory`. */
    load: (fixture: Fixture, directory: string, options: PlayOptions = {}) =>
      Effect.gen(function* () {
        for (const session of sessions.values()) yield* stopPlayback(session);
        sessions.clear();
        calls.length = 0;
        replies.clear();
        mcp = { _tag: "connected" };
        yield* add(fixture, directory, options);
      }),
    /** Plays another fixture at the same time, in a session of its own. */
    add,
    /**
     * Waits for the adapter to send each session's prompt (it subscribes to events
     * before that), then for each turn's recording to play to its end, or to be withdrawn.
     */
    played: Effect.suspend(() =>
      Effect.forEach(
        [...sessions.values()],
        (session) =>
          Deferred.await(session.prompted).pipe(
            Effect.andThen(Effect.suspend(() => (session.playback === undefined ? Effect.void : Effect.asVoid(Fiber.await(session.playback))))),
          ),
        { discard: true },
      ),
    ),
    /** Lets turns held by `holdStart` start. */
    release: Effect.suspend(() =>
      Effect.forEach([...sessions.values()], (session) => (session.startGate === undefined ? Effect.void : Deferred.succeed(session.startGate, undefined)), {
        discard: true,
      }),
    ),
    /** How OpenCode answers when the vault tools are added from now on. */
    setMcp: (status: OpenCodeMcpStatus | "refused") =>
      Effect.sync(() => {
        mcp = status;
      }),
    /** Done once the adapter has made `call` at least `times` times (since the last load). */
    made: (call: FakeCall["call"], times: number) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        waiters.push({ call, times, done });
        if (calls.filter((each) => each.call === call).length >= times) yield* Deferred.succeed(done, undefined);
        yield* Deferred.await(done);
      }),
    /** As if the event stream dropped and came back. */
    reconnect: PubSub.publish(hub, { _tag: "reconnected" }),
  };
});

export type FakeOpenCode = Effect.Success<typeof makeFakeOpenCode>;
