import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { Data, Effect, FileSystem, Option } from "effect";
import { ID_PATTERN } from "./definition.js";

/*
 * Writing the config directory's files from the app, as the note editor writes
 * notes: hash-checked, atomic, and never replacing a file it didn't mean to. The
 * directory is synced between machines (Syncthing), so a file can change under an
 * open editor at any time.
 */

/** The file isn't the version the edit started from (changed, deleted, or created meanwhile). */
export class ConfigFileChanged extends Data.TaggedError("ConfigFileChanged")<{
  readonly path: string;
}> {}

/** The file the edit would write is one the app would refuse to load; each problem names its field. */
export class ConfigFileInvalid extends Data.TaggedError("ConfigFileInvalid")<{
  readonly problems: ReadonlyArray<string>;
}> {}

/** No agent or rules file with this id. */
export class ConfigFileNotFound extends Data.TaggedError("ConfigFileNotFound")<{
  readonly path: string;
}> {}

/** Where deleted agents and rules go, by folder: `<config dir>/.trash/agents/`. Hidden, so never loaded. */
export const CONFIG_TRASH = ".trash";

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An id the loader would accept as a file name, else `ConfigFileInvalid`. */
export const requireId = (id: string) =>
  ID_PATTERN.test(id)
    ? Effect.void
    : Effect.fail(new ConfigFileInvalid({ problems: [`id: Lowercase letters, digits and hyphens only, starting with a letter or digit (got "${id}").`] }));

/** The file's text and hash, or None when it doesn't exist. */
export const readConfigFile = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(path).pipe(
    Effect.map(Option.some),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none())),
  );
  if (Option.isNone(info)) return Option.none();
  if (info.value.type !== "File") return yield* new ConfigFileInvalid({ problems: [`${path} isn't a file.`] });
  const bytes = yield* fs.readFile(path);
  return Option.some({ text: new TextDecoder().decode(bytes), hash: sha256(bytes), mode: info.value.mode });
});

/**
 * Writes `text` to `path` only if the file still has `baseHash` (null: it mustn't
 * exist), else `ConfigFileChanged` and nothing is written. The text goes to a
 * hidden temporary file beside it (dot-names are never loaded), which is renamed
 * over the file, or hard-linked into place for a new one, since a link fails
 * rather than replacing a file someone else just created. Returns the new hash.
 */
export const writeConfigFile = Effect.fnUntraced(function* (path: string, text: string, baseHash: string | null) {
  const fs = yield* FileSystem.FileSystem;
  const existing = yield* readConfigFile(path);
  if ((Option.getOrUndefined(existing)?.hash ?? null) !== baseHash) return yield* new ConfigFileChanged({ path });
  const bytes = new TextEncoder().encode(text);
  const hash = sha256(bytes);
  if (Option.isSome(existing) && existing.value.hash === hash) return hash;

  yield* fs.makeDirectory(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  yield* Effect.gen(function* () {
    yield* fs.writeFile(temporary, bytes);
    if (Option.isSome(existing)) {
      yield* fs.chmod(temporary, existing.value.mode & 0o7777);
      yield* fs.rename(temporary, path);
    } else {
      yield* fs.link(temporary, path).pipe(Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.fail(new ConfigFileChanged({ path }))));
      yield* fs.remove(temporary);
    }
  }).pipe(Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)));
  return hash;
});

/** `researcher.md`, then `researcher 1.md`, `researcher 2.md`… */
const candidate = (id: string, attempt: number) => (attempt === 0 ? `${id}.md` : `${id} ${attempt}.md`);

/**
 * Moves `<configDir>/<folder>/<id>.md` to `<configDir>/.trash/<folder>/`, only if it
 * still has `hash`, else `ConfigFileChanged`. Hard-linked to the first free name
 * and then removed, so nothing in the trash is replaced. Returns where it went.
 */
export const trashConfigFile = Effect.fnUntraced(function* (configDir: string, folder: "agents" | "rules", id: string, hash: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(configDir, folder, `${id}.md`);
  const existing = yield* readConfigFile(path);
  if (Option.isNone(existing)) return yield* new ConfigFileNotFound({ path });
  if (existing.value.hash !== hash) return yield* new ConfigFileChanged({ path });
  const trash = join(configDir, CONFIG_TRASH, folder);
  yield* fs.makeDirectory(trash, { recursive: true });
  let trashPath: string | undefined;
  for (let attempt = 0; trashPath === undefined; attempt += 1) {
    const target = join(trash, candidate(id, attempt));
    const linked = yield* fs.link(path, target).pipe(
      Effect.as(true),
      Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
    );
    if (linked) trashPath = target;
  }
  yield* fs.remove(path);
  return trashPath;
});
