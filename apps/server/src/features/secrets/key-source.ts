import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { KeySource } from "@wiki-agents/contracts/secrets/model";
import { Data, Duration, Effect, FileSystem, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { KEY_BYTES, newKey } from "./envelope.js";

/** The key is there but can't be read, or can't be made here; `reason` is for Settings. */
export class KeyUnavailable extends Data.TaggedError("KeyUnavailable")<{ readonly reason: string }> {}

/**
 * Where the key that unlocks the stored secrets lives. It is made the first time a
 * secret is stored and kept outside the data directory, so a copy of the data
 * directory alone opens nothing.
 */
export interface KeyStore {
  readonly kind: KeySource;
  /** Changes when the key's file is made, replaced or removed, so a cached "it opens" can be checked cheaply. */
  readonly fingerprint: Effect.Effect<string>;
  /** The key, or None when none has been made. */
  readonly load: Effect.Effect<Option.Option<Uint8Array>, KeyUnavailable>;
  /** Makes and keeps a key; if another process made one meanwhile, that one. */
  readonly create: Effect.Effect<Uint8Array, KeyUnavailable>;
}

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The file's bytes, or None when it doesn't exist. */
const read = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFile(path).pipe(
    Effect.map(Option.some),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none<Uint8Array>())),
    Effect.mapError((cause) => new KeyUnavailable({ reason: `Couldn't read ${path}: ${describe(cause)}` })),
  );

/**
 * Puts `bytes` at `path` (0600, its folder 0700) unless a file is already there:
 * written beside it and hard-linked into place, which fails rather than replacing.
 * Returns whether this call made the file.
 */
const writeNew = (fs: FileSystem.FileSystem, path: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
    return yield* Effect.gen(function* () {
      yield* fs.writeFile(temporary, bytes, { mode: 0o600 });
      return yield* fs.link(temporary, path).pipe(
        Effect.as(true),
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
      );
    }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)));
  }).pipe(Effect.mapError((cause) => new KeyUnavailable({ reason: `Couldn't write ${path}: ${describe(cause)}` })));

/** The file's identity and change time, or "missing". */
const fingerprintOf = (fs: FileSystem.FileSystem, path: string) =>
  fs.stat(path).pipe(
    Effect.map((info) => `${String(info.ino)}:${Option.match(info.mtime, { onNone: () => "", onSome: (date) => String(date.getTime()) })}:${String(info.size)}`),
    Effect.orElseSucceed(() => "missing"),
  );

const checked = (path: string) => (key: Uint8Array) =>
  key.length === KEY_BYTES ? Effect.succeed(key) : Effect.fail(new KeyUnavailable({ reason: `${path} isn't a key this app made.` }));

/** A key file readable only by you. Guards copies of the data directory, not anything that can read your files. */
export const fileKeyStore = (fs: FileSystem.FileSystem, path: string): KeyStore => {
  const load = Effect.flatMap(read(fs, path), (found) => (Option.isNone(found) ? Effect.succeed(found) : Effect.map(checked(path)(found.value), Option.some)));
  return {
    kind: "file",
    fingerprint: fingerprintOf(fs, path),
    load,
    create: Effect.gen(function* () {
      const key = newKey();
      if (yield* writeNew(fs, path, key)) return key;
      const existing = yield* load;
      return Option.isSome(existing) ? existing.value : yield* new KeyUnavailable({ reason: `${path} appeared and went while the key was being made.` });
    }),
  };
};

const CREDENTIAL_NAME = "wiki-agents-secrets";
const TIME_LIMIT = Duration.seconds(20);

/** Runs `systemd-creds --user <verb> - -` with `input` on stdin; its stdout, or why it failed. */
const systemdCreds = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], verb: "encrypt" | "decrypt", input: Uint8Array) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("systemd-creds", ["--user", `--name=${CREDENTIAL_NAME}`, verb, "-", "-"], {
          stdin: Stream.succeed(input),
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const [out, errors, code] = yield* Effect.all(
        [Stream.runCollect(handle.stdout), handle.stderr.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
        { concurrency: 3 },
      );
      if (Number(code) !== 0) return yield* new KeyUnavailable({ reason: `systemd-creds ${verb} failed: ${errors.trim() || `exit code ${Number(code)}`}` });
      return Buffer.concat([...out]);
    }),
  ).pipe(
    Effect.timeoutOrElse({ duration: TIME_LIMIT, orElse: () => Effect.fail(new KeyUnavailable({ reason: `systemd-creds ${verb} didn't finish.` })) }),
    Effect.mapError((cause) => (cause instanceof KeyUnavailable ? cause : new KeyUnavailable({ reason: `Couldn't run systemd-creds: ${describe(cause)}` }))),
  );

/**
 * The key encrypted by systemd for this user on this machine (`systemd-creds --user`,
 * systemd 256 or later): with the TPM where there is one, else with the host's
 * credential key. The file at `path` is useless anywhere else.
 */
export const systemdCredsKeyStore = (fs: FileSystem.FileSystem, spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], path: string): KeyStore => {
  const load = Effect.gen(function* () {
    const found = yield* read(fs, path);
    if (Option.isNone(found)) return Option.none<Uint8Array>();
    return Option.some(yield* Effect.flatMap(systemdCreds(spawner, "decrypt", found.value), checked(path)));
  });
  return {
    kind: "systemd-creds",
    fingerprint: fingerprintOf(fs, path),
    load,
    create: Effect.gen(function* () {
      const key = newKey();
      const encrypted = yield* systemdCreds(spawner, "encrypt", key);
      if (yield* writeNew(fs, path, encrypted)) return key;
      const existing = yield* load;
      return Option.isSome(existing) ? existing.value : yield* new KeyUnavailable({ reason: `${path} appeared and went while the key was being made.` });
    }),
  };
};
