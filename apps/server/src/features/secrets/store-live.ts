import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type KeySource, MAX_SECRET_BYTES, type SecretStoreStatus } from "@wiki-agents/contracts/secrets/model";
import { Clock, Effect, FileSystem, Layer, Option, Ref, Result, Schema, Semaphore } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { ID_PATTERN } from "../../shared/config-files.js";
import { AppConfig } from "../../shared/config.js";
import { type DeclaredSecrets, parseDeclaredSecrets } from "./declared.js";
import { credentialContext, DEK_CONTEXT, newKey, open, seal, secretContext, SecretsFile } from "./envelope.js";
import { fileKeyStore, type KeyStore, systemdCredsKeyStore } from "./key-source.js";
import { SecretDeclared, type SecretInfo, SecretInvalid, SecretNotFound, SecretStore, SecretStoreUnavailable, SecretUnavailable } from "./secret-store.js";

export interface SecretStoreOptions {
  /** Where `secrets.enc` goes: `<data dir>/secrets`. */
  readonly dir: string;
  /** The key file; the systemd-encrypted key is kept beside it as `<keyFile>.cred`. Outside the data directory. */
  readonly keyFile: string;
  /** Which key source a new store uses; `auto` takes systemd-creds where it works, else the key file. */
  readonly keySource: KeySource | "auto";
  readonly declared: DeclaredSecrets;
}

const FILE_NAME = "secrets.enc";
const START_AGAIN = "Delete the stored secrets and enter them again.";

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const decodeFile = Schema.decodeUnknownResult(SecretsFile);

/** Secrets and credentials: what a new key would make unreadable. */
const entryCount = (file: SecretsFile) => Object.keys(file.secrets).length + Object.keys(file.credentials ?? {}).length;

/**
 * Stored secrets in `<dir>/secrets.enc` (0600, the folder 0700), read from the file on
 * every call and written whole through a temporary file, one writer at a time. No key
 * or value is kept in memory between calls.
 */
export const makeSecretStore = (options: SecretStoreOptions) =>
  Layer.effect(
    SecretStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // Made now, so the folder exists for Codex's sandbox to deny before the first secret
      // is saved (it leaves out missing paths); writing makes it again if this failed.
      yield* fs.makeDirectory(options.dir, { recursive: true, mode: 0o700 }).pipe(Effect.ignore);
      const path = join(options.dir, FILE_NAME);
      const writing = yield* Semaphore.make(1);
      /**
       * Whether this wrapped data key opened with the key file as it was then, so listing
       * doesn't ask systemd every time; a key file made, replaced or removed is checked again.
       */
      const checked = yield* Ref.make<{ readonly wrapped: string; readonly key: string; readonly problem: string | null } | null>(null);

      const keyStores: Readonly<Record<KeySource, KeyStore>> = {
        "systemd-creds": systemdCredsKeyStore(fs, spawner, `${options.keyFile}.cred`),
        file: fileKeyStore(fs, options.keyFile),
      };
      const unavailable = (what: string) => (cause: unknown) => new SecretStoreUnavailable({ reason: `${what}: ${describe(cause)}` });

      const readFile = Effect.gen(function* () {
        const bytes = yield* fs.readFile(path).pipe(
          Effect.map(Option.some),
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none<Uint8Array>())),
          Effect.mapError(unavailable(`Couldn't read ${path}`)),
        );
        if (Option.isNone(bytes)) return Option.none<SecretsFile>();
        const parsed = yield* Effect.try({ try: () => JSON.parse(new TextDecoder().decode(bytes.value)) as unknown, catch: () => null }).pipe(Effect.result);
        const decoded = Result.isSuccess(parsed) ? decodeFile(parsed.success) : undefined;
        if (decoded === undefined || Result.isFailure(decoded)) return yield* new SecretStoreUnavailable({ reason: `${path} isn't a secrets file this app wrote.` });
        return Option.some(decoded.success);
      });

      const writeFile = (file: SecretsFile) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(options.dir, { recursive: true, mode: 0o700 });
          const temporary = join(options.dir, `.${FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
          yield* fs.writeFile(temporary, new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`), { mode: 0o600 }).pipe(
            Effect.andThen(fs.rename(temporary, path)),
            Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)),
          );
        }).pipe(Effect.mapError(unavailable(`Couldn't write ${path}`)));

      /** The data key of `file`, or why it can't be had (the key is missing, or isn't the one that wrapped it). */
      const unlock = (file: SecretsFile) =>
        Effect.gen(function* () {
          const kek = yield* keyStores[file.kek.source].load.pipe(Effect.mapError((error) => error.reason));
          if (Option.isNone(kek)) return yield* Effect.fail("The key for the stored secrets is missing from this machine.");
          const dek = open(kek.value, DEK_CONTEXT, file.kek.wrappedDek);
          kek.value.fill(0);
          if (dek === undefined) return yield* Effect.fail("The stored secrets were encrypted with another key.");
          return dek;
        });

      /** A new file: a data key wrapped by a key from the configured source, or the first source that works. */
      const start = Effect.gen(function* () {
        const order: ReadonlyArray<KeySource> = options.keySource === "auto" ? ["systemd-creds", "file"] : [options.keySource];
        const reasons: Array<string> = [];
        for (const kind of order) {
          const store = keyStores[kind];
          const key = yield* Effect.gen(function* () {
            const existing = yield* store.load;
            return Option.isSome(existing) ? existing.value : yield* store.create;
          }).pipe(Effect.result);
          if (Result.isFailure(key)) {
            reasons.push(key.failure.reason);
            continue;
          }
          const dek = newKey();
          const file: SecretsFile = { version: 1, kek: { source: kind, wrappedDek: seal(key.success, DEK_CONTEXT, dek) }, secrets: {} };
          key.success.fill(0);
          return { file, dek };
        }
        return yield* new SecretStoreUnavailable({ reason: `No key could be made for the stored secrets. ${reasons.join(" ")}` });
      });

      const status = (file: Option.Option<SecretsFile>) =>
        Effect.gen(function* () {
          if (Option.isNone(file)) return { state: "empty", keySource: null, problem: null } satisfies SecretStoreStatus;
          const { source, wrappedDek } = file.value.kek;
          if (entryCount(file.value) === 0) return { state: "empty", keySource: source, problem: null } satisfies SecretStoreStatus;
          const last = yield* Ref.get(checked);
          const key = yield* keyStores[source].fingerprint;
          let problem: string | null;
          if (last !== null && last.wrapped === wrappedDek.ciphertext && last.key === key) {
            problem = last.problem;
          } else {
            const unlocked = yield* unlock(file.value).pipe(Effect.result);
            if (Result.isSuccess(unlocked)) unlocked.success.fill(0);
            problem = Result.isSuccess(unlocked) ? null : unlocked.failure;
            yield* Ref.set(checked, { wrapped: wrappedDek.ciphertext, key, problem });
          }
          return { state: problem === null ? "ready" : "unreadable", keySource: source, problem: problem === null ? null : `${problem} ${START_AGAIN}` } satisfies SecretStoreStatus;
        });

      const declaredInfo = (name: string, file: string) =>
        fs.stat(file).pipe(
          Effect.map((info) => (info.type === "File" ? null : `${file} isn't a file.`)),
          Effect.catch((cause) => Effect.succeed(`${file} can't be read: ${describe(cause)}`)),
          Effect.map((problem): SecretInfo => ({ name, source: "declared", createdAt: null, expiresAt: null, available: problem === null, problem })),
        );

      const list = Effect.gen(function* () {
        const file = yield* readFile.pipe(Effect.result);
        const store: SecretStoreStatus = Result.isSuccess(file) ? yield* status(file.success) : { state: "unreadable", keySource: null, problem: file.failure.reason };
        const stored = Result.isSuccess(file) && Option.isSome(file.success) ? file.success.value.secrets : {};
        const secrets: Array<SecretInfo> = [];
        for (const [name, declared] of options.declared.files) secrets.push(yield* declaredInfo(name, declared));
        for (const [name, entry] of Object.entries(stored)) {
          if (options.declared.files.has(name)) continue;
          secrets.push({ name, source: "stored", createdAt: entry.createdAt, expiresAt: entry.expiresAt, available: store.state === "ready", problem: store.state === "ready" ? null : store.problem });
        }
        return { secrets: secrets.sort((a, b) => a.name.localeCompare(b.name)), store, problems: options.declared.problems };
      });

      const set = Effect.fnUntraced(function* (input: { readonly name: string; readonly value: string; readonly expiresAt: number | null }) {
        const problems: Array<string> = [];
        if (!ID_PATTERN.test(input.name)) problems.push("name: Lowercase letters, digits and hyphens only, starting with a letter or digit.");
        const bytes = Buffer.from(input.value, "utf8");
        if (bytes.length === 0) problems.push("value: Paste the secret's value.");
        if (bytes.length > MAX_SECRET_BYTES) problems.push(`value: Longer than ${MAX_SECRET_BYTES / 1024} KiB; secrets are tokens and keys, not files.`);
        if (input.expiresAt !== null && !(Number.isSafeInteger(input.expiresAt) && input.expiresAt > 0)) problems.push("expiresAt: Not a date.");
        if (problems.length > 0) return yield* new SecretInvalid({ problems });
        const declared = options.declared.files.get(input.name);
        if (declared !== undefined) return yield* new SecretDeclared({ name: input.name, path: declared });

        return yield* Effect.gen(function* () {
          const { file, dek } = yield* forWriting;
          const createdAt = yield* Clock.currentTimeMillis;
          const entry = { ...seal(dek, secretContext(input.name), bytes), createdAt, expiresAt: input.expiresAt };
          dek.fill(0);
          bytes.fill(0);
          yield* writeFile({ ...file, secrets: { ...file.secrets, [input.name]: entry } });
          yield* Ref.set(checked, { wrapped: file.kek.wrappedDek.ciphertext, key: yield* keyStores[file.kek.source].fingerprint, problem: null });
          return { name: input.name, source: "stored", createdAt, expiresAt: input.expiresAt, available: true, problem: null } satisfies SecretInfo;
        }).pipe(writing.withPermits(1));
      });

      /**
       * The file to add a value to, and its data key: the existing one when it holds
       * anything, else (nothing to lose) the file's key when it opens, or a new one.
       * Call holding the `writing` permit.
       */
      const forWriting = Effect.gen(function* () {
        const existing = yield* readFile;
        if (Option.isSome(existing) && entryCount(existing.value) > 0) {
          const dek = yield* unlock(existing.value).pipe(Effect.mapError((reason) => new SecretStoreUnavailable({ reason: `${reason} ${START_AGAIN}` })));
          return { file: existing.value, dek };
        }
        const reused = Option.isSome(existing) ? yield* unlock(existing.value).pipe(Effect.result) : undefined;
        if (reused !== undefined && Result.isSuccess(reused) && Option.isSome(existing)) return { file: existing.value, dek: reused.success };
        return yield* start;
      });

      const readCredentials = (prefix: string) =>
        Effect.gen(function* () {
          const values = new Map<string, string>();
          const file = yield* readFile;
          if (Option.isNone(file)) return values;
          const entries = Object.entries(file.value.credentials ?? {}).filter(([key]) => key.startsWith(prefix));
          if (entries.length === 0) return values;
          const dek = yield* unlock(file.value).pipe(Effect.mapError((reason) => new SecretStoreUnavailable({ reason })));
          for (const [key, entry] of entries) {
            const plain = open(dek, credentialContext(key), entry);
            if (plain === undefined) continue;
            values.set(key, plain.toString("utf8"));
            plain.fill(0);
          }
          dek.fill(0);
          return values;
        });

      const writeCredential = (key: string, value: string | null) =>
        Effect.gen(function* () {
          if (value === null) {
            const existing = yield* readFile;
            if (Option.isNone(existing) || !(key in (existing.value.credentials ?? {}))) return;
            const { [key]: _removed, ...credentials } = existing.value.credentials ?? {};
            return yield* writeFile({ ...existing.value, credentials });
          }
          const { file, dek } = yield* forWriting;
          const bytes = Buffer.from(value, "utf8");
          const entry = seal(dek, credentialContext(key), bytes);
          dek.fill(0);
          bytes.fill(0);
          yield* writeFile({ ...file, credentials: { ...file.credentials, [key]: entry } });
        }).pipe(writing.withPermits(1));

      const remove = (name: string) =>
        Effect.gen(function* () {
          const existing = yield* readFile;
          if (Option.isNone(existing) || !(name in existing.value.secrets)) {
            const declared = options.declared.files.get(name);
            return yield* declared === undefined ? new SecretNotFound({ name }) : new SecretDeclared({ name, path: declared });
          }
          const { [name]: _removed, ...secrets } = existing.value.secrets;
          yield* writeFile({ ...existing.value, secrets });
        }).pipe(writing.withPermits(1));

      const resolve = Effect.fnUntraced(function* (name: string) {
        const fail = (reason: string) => new SecretUnavailable({ name, reason });
        const declared = options.declared.files.get(name);
        if (declared !== undefined) {
          const text = yield* fs.readFileString(declared).pipe(Effect.mapError((cause) => fail(`${declared} can't be read: ${describe(cause)}`)));
          // Secret files usually end with a new line that isn't part of the value.
          const value = text.replace(/\r?\n$/, "");
          return value === "" ? yield* fail(`${declared} is empty.`) : value;
        }
        const file = yield* readFile.pipe(Effect.mapError((error) => fail(error.reason)));
        const entry = Option.isSome(file) ? file.value.secrets[name] : undefined;
        if (Option.isNone(file) || entry === undefined) return yield* fail(`There is no secret "${name}"; add it in Settings › Secrets.`);
        const dek = yield* unlock(file.value).pipe(Effect.mapError((reason) => fail(`${reason} ${START_AGAIN}`)));
        const plain = open(dek, secretContext(name), entry);
        dek.fill(0);
        if (plain === undefined) return yield* fail(`The stored secret "${name}" is damaged; enter it again.`);
        const value = plain.toString("utf8");
        plain.fill(0);
        return value;
      });

      const files = [options.dir, options.keyFile, `${options.keyFile}.cred`, ...options.declared.files.values()];
      return SecretStore.of({ list, set, delete: remove, resolve, readCredentials, writeCredential, files, runDirectory: join(options.dir, "run") });
    }),
  );

/** The store in `<data dir>/secrets`, its key under `$XDG_STATE_HOME/wiki-agents`, with the declared files of `WIKI_AGENTS_SECRET_FILES`. */
export const SecretStoreLive = Layer.unwrap(
  Effect.gen(function* () {
    const dataDir = yield* AppConfig.dataDir.pipe(Effect.orDie);
    const keyFile = yield* AppConfig.secretsKeyFile.pipe(Effect.orDie);
    const keySource = yield* AppConfig.secretsKey.pipe(Effect.orDie);
    const declared = yield* AppConfig.secretFiles.pipe(Effect.orDie);
    return makeSecretStore({ dir: join(dataDir, "secrets"), keyFile, keySource, declared: parseDeclaredSecrets(declared) });
  }),
);

