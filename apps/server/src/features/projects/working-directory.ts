import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Effect, FileSystem } from "effect";
import { expandHome } from "../../shared/paths.js";
import { isInside } from "../../shared/vault/path-guard.js";
import { InvalidProject } from "./errors.js";

const invalid = (message: string) => new InvalidProject({ message });

const containsHomeFolder = (path: string) => isInside(path, homedir());

export const absoluteDirectory = Effect.fnUntraced(function* (input: string) {
  const expanded = expandHome(input.trim());
  if (!isAbsolute(expanded)) return yield* invalid("Working directories must be absolute paths");
  return resolve(expanded);
});

export const canonicalDirectory = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const canonical = yield* fs.realPath(path).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
  const info = yield* fs.stat(canonical).pipe(Effect.mapError(() => invalid("Cannot read working directory: " + path)));
  if (info.type !== "Directory") return yield* invalid("Not a directory: " + path);
  if (containsHomeFolder(canonical)) return yield* invalid("Too broad for a working directory: " + path);
  return canonical;
});
