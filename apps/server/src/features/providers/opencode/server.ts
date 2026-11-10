import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { NodeHttpClient } from "@effect/platform-node";
import { OpenCode, type OpenCodeClient } from "@opencode/client/effect";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, PubSub, Schedule, type Scope, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type OpenCodeApi, OpenCodeError, type OpenCodeSignal, modelName, modelRef } from "./api.js";
import { INSTRUCTIONS_KEY } from "./instructions.js";

/**
 * The OpenCode version the pinned `@opencode/client` speaks. Other 2.2 releases are
 * accepted; anything else is reported as unsupported before a turn can fail on it.
 */
export const CLIENT_VERSION = "2.2.1";

export const isSupportedVersion = (version: string) => {
  const [major, minor] = version.replace(/^v/, "").split(".");
  const [clientMajor, clientMinor] = CLIENT_VERSION.split(".");
  return major === clientMajor && minor === clientMinor;
};

const STARTUP_TIMEOUT = Duration.seconds(30);
const CALL_TIMEOUT = Duration.seconds(30);
const RECONNECT_DELAY = Duration.seconds(1);

export interface ServerOptions {
  /** The `opencode` executable: a path, or a name looked up on `PATH`. */
  readonly binary: string;
}

const describe = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null) {
    if ("message" in cause && typeof cause.message === "string" && cause.message !== "") return cause.message;
    if ("_tag" in cause && typeof cause._tag === "string") return cause._tag;
  }
  return String(cause);
};

const call = <A, E>(what: string, effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: CALL_TIMEOUT,
      orElse: () => Effect.fail(new OpenCodeError({ message: `OpenCode didn't answer ${what} within ${Duration.format(CALL_TIMEOUT)}.` })),
    }),
    Effect.mapError((cause) => (cause instanceof OpenCodeError ? cause : new OpenCodeError({ message: `${what}: ${describe(cause)}`, cause }))),
  );

/** Waits for the process to exit, killing it if it ignores SIGTERM. */
const stop = (child: ChildProcess) =>
  Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) return resume(Effect.void);
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(kill);
      resume(Effect.void);
    });
    child.kill("SIGTERM");
  });

/**
 * The URL in OpenCode's own startup line (`server listening on http://127.0.0.1:41234`),
 * and nothing else that happens to say "listening on" (a plugin, an inspector).
 */
export const listeningUrl = (line: string): string | undefined =>
  /^server listening on (http:\/\/127\.0\.0\.1:\d+)\/?\s*$/i.exec(line.trim())?.[1];

/**
 * The password OpenCode prints (`server password …`) when it didn't get
 * `OPENCODE_PASSWORD` and made one up, as it does inside a sandbox (landrun) that
 * passes on only the environment variables it is told to.
 */
export const printedPassword = (line: string): string | undefined => /^server password (\S+)\s*$/i.exec(line.trim())?.[1];

/** A started `opencode serve`: its URL, its own password if it printed one, and its last lines of output for error messages. */
interface Launched {
  readonly url: string;
  readonly printedPassword: Deferred.Deferred<string>;
  /** Completes with how the process ended, if it ends (crashed, killed, or stopped by the app). */
  readonly exited: Deferred.Deferred<string>;
  readonly output: () => string;
}

/**
 * Starts `opencode serve` on localhost with a generated password, and resolves once
 * it says where it is listening. OpenCode picks the port (`--port=0`), so nothing
 * can take it between choosing and binding. Closing the scope stops it.
 */
const launch = (options: ServerOptions, password: string) =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_PASSWORD: password };
    delete env.OPENCODE_SERVER_PASSWORD;
    const child = yield* Effect.acquireRelease(
      Effect.sync(() => spawn(options.binary, ["serve", "--hostname=127.0.0.1", "--port=0"], { env, stdio: ["ignore", "pipe", "pipe"] })),
      stop,
    );
    const lines: Array<string> = [];
    const output = () => lines.slice(-5).join(" / ");
    const listening = yield* Deferred.make<string, OpenCodeError>();
    const printed = yield* Deferred.make<string>();
    /** Output split into whole lines, as a chunk can end mid-line. */
    const reader = () => {
      let partial = "";
      return (chunk: Buffer) => {
        const parts = (partial + chunk.toString("utf8")).split("\n");
        partial = parts.pop() ?? "";
        for (const line of parts) {
          if (line.trim() === "") continue;
          const ownPassword = printedPassword(line);
          if (ownPassword !== undefined) Deferred.doneUnsafe(printed, Exit.succeed(ownPassword));
          // Never keep the password in output that error messages show.
          lines.push(ownPassword === undefined ? line.trim() : "server password (hidden)");
          if (lines.length > 20) lines.shift();
          const url = listeningUrl(line);
          if (url !== undefined) Deferred.doneUnsafe(listening, Exit.succeed(url));
        }
      };
    };
    child.stdout?.on("data", reader());
    child.stderr?.on("data", reader());
    child.once("error", (cause) =>
      Deferred.doneUnsafe(
        listening,
        Exit.fail(
          new OpenCodeError({
            message: "code" in cause && cause.code === "ENOENT" ? `OpenCode isn't installed (no "${options.binary}" on PATH).` : cause.message,
            cause,
          }),
        ),
      ),
    );
    const exited = yield* Deferred.make<string>();
    child.once("exit", (code, signal) => {
      const how = signal ?? `code ${code}`;
      Deferred.doneUnsafe(exited, Exit.succeed(how));
      Deferred.doneUnsafe(listening, Exit.fail(new OpenCodeError({ message: `OpenCode exited (${how}) before it started: ${output()}` })));
    });
    const url = yield* Deferred.await(listening).pipe(
      Effect.timeoutOrElse({
        duration: STARTUP_TIMEOUT,
        orElse: () => Effect.fail(new OpenCodeError({ message: `OpenCode didn't start within ${Duration.format(STARTUP_TIMEOUT)}: ${output()}` })),
      }),
    );
    const launched: Launched = { url, printedPassword: printed, exited, output };
    return launched;
  });

/** The live API over a started client. */
const makeApi = (client: OpenCodeClient, version: string, hub: PubSub.PubSub<OpenCodeSignal>, isStopped: Effect.Effect<boolean>): OpenCodeApi => ({
  version,
  isStopped,
  subscribe: PubSub.subscribe(hub),
  createSession: ({ directory, model, permissions }) => {
    const ref = model === null ? null : modelRef(model);
    return call(
      "creating a session",
      client.session.create({
        location: { directory: directory as never },
        permissions: permissions as never,
        ...(ref === null ? {} : { model: ref as never }),
      }),
    ).pipe(Effect.map((session) => session.id as string));
  },
  setPermissions: (sessionId, permissions) =>
    call("updating the session's permissions", client.session.update({ sessionID: sessionId as never, permissions: permissions as never })),
  setInstructions: (sessionId, text) =>
    text === null
      ? call("removing the session's instructions", client.experimental.session.instructions.entry.remove({ sessionID: sessionId as never, key: INSTRUCTIONS_KEY }))
      : call(
          "setting the session's instructions",
          client.experimental.session.instructions.entry.put({ sessionID: sessionId as never, key: INSTRUCTIONS_KEY, value: text }),
        ),
  sessionExists: (sessionId) =>
    call(
      "finding the session",
      client.session.get({ sessionID: sessionId as never }).pipe(
        Effect.as(true),
        Effect.catchTag("SessionNotFoundError", () => Effect.succeed(false)),
      ),
    ),
  prompt: (sessionId, text) =>
    call("sending the message", client.session.prompt({ sessionID: sessionId as never, text })).pipe(Effect.map((item) => item.id as string)),
  cancelPrompt: (sessionId, inboxId) =>
    call("withdrawing the message", client.session.inbox.cancel({ sessionID: sessionId as never, inboxID: inboxId as never })),
  interrupt: (sessionId) =>
    call("stopping the turn", client.session.interrupt({ sessionID: sessionId as never })).pipe(Effect.map((result) => result.interrupted)),
  isRunning: (sessionId) => call("checking the session", client.session.active()).pipe(Effect.map((active) => sessionId in active)),
  lastOutcome: (sessionId) =>
    call("reading the session", client.message.list({ sessionID: sessionId as never, type: "idle", order: "desc", limit: 1 })).pipe(
      Effect.map((page) => {
        const idle = page.data[0];
        return idle !== undefined && idle.type === "idle" ? idle.outcome : null;
      }),
    ),
  replyPermission: (sessionId, requestId, reply, message) =>
    call(
      "answering the approval",
      client.permission.reply({
        sessionID: sessionId as never,
        requestID: requestId as never,
        decision: reply,
        ...(message === undefined ? {} : { message }),
      }),
    ),
  replyForm: (sessionId, formId, answer) =>
    call("answering the question", client.session.form.reply({ sessionID: sessionId, formID: formId as never, answer })),
  listModels: (directory) =>
    call("listing models", client.model.list({ location: { directory } })).pipe(
      Effect.map((list) =>
        list.data
          .filter((model) => model.enabled && model.status !== "deprecated" && model.type === "chat")
          .map((model) => ({
            id: modelName(model),
            name: model.name,
            free: model.cost.every((cost) => cost.input === 0 && cost.output === 0),
          })),
      ),
    ),
  defaultModel: (directory) =>
    call("reading the default model", client.model.default({ location: { directory } })).pipe(
      Effect.map((result) => (result.data === undefined ? null : modelName(result.data))),
    ),
  switchModel: (sessionId, model) => {
    const ref = modelRef(model);
    if (ref === null) return Effect.fail(new OpenCodeError({ message: `Not an OpenCode model: ${model}` }));
    return call("switching the model", client.session.switchModel({ sessionID: sessionId as never, model: ref as never }));
  },
});

/**
 * Runs one `opencode serve` for the app and returns the API over it, once its event
 * stream is connected. The server and the stream stop when the scope closes.
 */
export const startServer = (options: ServerOptions): Effect.Effect<OpenCodeApi, OpenCodeError, Scope.Scope> =>
  Effect.gen(function* () {
    let password = randomBytes(24).toString("base64url");
    const launched = yield* launch(options, password);
    const { url } = launched;
    // Built in the server's scope: the client keeps using it after `make` returns.
    const http = yield* Layer.build(NodeHttpClient.layerUndici);
    const client = yield* OpenCode.make({ baseUrl: url }).pipe(
      Effect.updateService(HttpClient.HttpClient, (http) =>
        HttpClient.mapRequest(http, (request) =>
          HttpClientRequest.setHeader(request, "authorization", `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`),
        ),
      ),
      Effect.provide(http),
    );
    const info = client.server.info().pipe(
      Effect.timeoutOrElse({
        duration: CALL_TIMEOUT,
        orElse: () => Effect.fail(new OpenCodeError({ message: `OpenCode at ${url} didn't answer within ${Duration.format(CALL_TIMEOUT)}.` })),
      }),
    );
    const refused = (cause: unknown) => typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "UnauthorizedError";
    // Refused: OpenCode didn't get the app's password (a sandbox dropped the variable)
    // and made up its own, which it prints straight after saying where it listens.
    const server = yield* info.pipe(
      Effect.catchIf(refused, (cause) =>
        Effect.gen(function* () {
          const own = yield* Deferred.await(launched.printedPassword).pipe(Effect.timeoutOption("2 seconds"));
          if (own._tag === "None") return yield* Effect.fail(cause);
          password = own.value;
          return yield* info;
        }),
      ),
      Effect.mapError((cause) =>
        cause instanceof OpenCodeError
          ? cause
          : new OpenCodeError({
              message: refused(cause)
                ? `OpenCode at ${url} refused the app's password. Its output: ${launched.output()}`
                : `OpenCode at ${url} didn't answer: ${describe(cause)}`,
              cause,
            }),
      ),
    );

    const hub = yield* Effect.acquireRelease(PubSub.unbounded<OpenCodeSignal>(), PubSub.shutdown);
    const connected = yield* Deferred.make<void>();
    let reconnecting = false;
    const connection = client.event.subscribe().pipe(
      Stream.runForEach((event) => {
        if (event.type !== "server.connected") return PubSub.publish(hub, { _tag: "event", event });
        if (!reconnecting) return Deferred.succeed(connected, undefined);
        return PubSub.publish(hub, { _tag: "reconnected" });
      }),
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning("OpenCode event stream dropped", cause))),
      Effect.andThen(
        Effect.sync(() => {
          reconnecting = true;
        }),
      ),
    );
    const connectionFiber = yield* connection.pipe(Effect.repeat(Schedule.spaced(RECONNECT_DELAY)), Effect.forkScoped);
    // The process ending while the app still uses it is a crash: say so, and stop
    // reconnecting. (When the app stops it, this fiber is interrupted first.)
    let stopped = false;
    yield* Deferred.await(launched.exited).pipe(
      Effect.flatMap((how) =>
        Effect.gen(function* () {
          stopped = true;
          yield* Fiber.interrupt(connectionFiber);
          yield* Effect.logWarning(`OpenCode exited (${how}); the next turn starts it again. Its output: ${launched.output()}`);
          yield* PubSub.publish(hub, { _tag: "stopped" });
        }),
      ),
      Effect.forkScoped,
    );
    yield* Deferred.await(connected).pipe(
      Effect.timeoutOrElse({
        duration: STARTUP_TIMEOUT,
        orElse: () => Effect.fail(new OpenCodeError({ message: "OpenCode's event stream didn't connect." })),
      }),
    );
    return makeApi(client, server.version, hub, Effect.sync(() => stopped));
  });

/** Runs `opencode --version`, for the status check. */
export const binaryVersion = (binary: string) =>
  Effect.callback<string, OpenCodeError>((resume) => {
    const child = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", (cause) =>
      resume(
        Effect.fail(
          new OpenCodeError({
            message: "code" in cause && cause.code === "ENOENT" ? `OpenCode isn't installed (no "${binary}" on PATH).` : cause.message,
            cause,
          }),
        ),
      ),
    );
    child.once("exit", (code) => {
      const version = /(\d+\.\d+\.\d+\S*)/.exec(output)?.[1];
      resume(
        code === 0 && version !== undefined
          ? Effect.succeed(version)
          : Effect.fail(new OpenCodeError({ message: `"${binary} --version" failed: ${output.trim() || `exit code ${code}`}` })),
      );
    });
  });

