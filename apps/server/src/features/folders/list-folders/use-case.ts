import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ListFoldersResponse } from "@wiki-agents/contracts/folders/list-folders/response";
import { Data, Effect, FileSystem } from "effect";
import { expandHome } from "../../../shared/paths.js";

/** The path can't be listed; `message` says why and is shown to the user. */
export class FolderUnavailable extends Data.TaggedError("FolderUnavailable")<{
  readonly message: string;
  readonly reason: "invalid" | "missing" | "unreadable";
}> {}

/** The folders inside `input` (default: the home folder), by name. */
export const listFolders = Effect.fn("listFolders")(function* (input: string | undefined) {
  const fs = yield* FileSystem.FileSystem;
  const requested = expandHome(input?.trim() || "~");
  if (!isAbsolute(requested)) return yield* new FolderUnavailable({ message: "Use an absolute path", reason: "invalid" });
  const path = yield* fs.realPath(resolve(requested)).pipe(
    Effect.mapError(() => new FolderUnavailable({ message: `No folder at ${requested}`, reason: "missing" })),
  );
  const info = yield* fs.stat(path).pipe(Effect.mapError(() => new FolderUnavailable({ message: `Can't read ${path}`, reason: "unreadable" })));
  if (info.type !== "Directory") return yield* new FolderUnavailable({ message: `${path} isn't a folder`, reason: "invalid" });
  const entries = yield* fs
    .readDirectoryEntries(path)
    .pipe(Effect.mapError(() => new FolderUnavailable({ message: `Can't read ${path}`, reason: "unreadable" })));

  const folders: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    const isFolder =
      entry.type === "Directory" ||
      ((entry.type === "SymbolicLink" || entry.type === "Unknown") &&
        (yield* fs.stat(child).pipe(
          Effect.map((target) => target.type === "Directory"),
          Effect.orElseSucceed(() => false),
        )));
    if (isFolder) folders.push({ name: entry.name, path: child });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, home: homedir(), folders } satisfies ListFoldersResponse;
});
