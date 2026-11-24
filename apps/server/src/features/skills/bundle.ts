import type { BundleDifference } from "@wiki-agents/contracts/skills/model";
import { join } from "node:path";
import { Effect, FileSystem, type PlatformError } from "effect";
import { parse } from "yaml";
import { sha256 } from "../../shared/config-files.js";
import { type NodeFileError, readRegularFile } from "../../shared/node-files.js";
import { SkillConflict, SkillInvalid } from "./errors.js";

const MAX_FILES = 1000;
const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 256 * 1024;
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type StorageFailure = PlatformError.PlatformError | NodeFileError;

const invalid = (message: string) => new SkillInvalid({ message });

export const checkName = (name: string) =>
  name.length > 64 || !namePattern.test(name)
    ? Effect.fail(invalid("Use up to 64 lowercase letters, digits and single hyphens for the skill name."))
    : Effect.void;

export const info = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.lstat(path).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
  );
});

export const isDirectory = (path: string) => Effect.map(info(path), (stat) => stat?.type === "Directory");

export const readRegular = (path: string, limit: number) =>
  readRegularFile(path, limit).pipe(
    Effect.catchTags({
      UnsupportedFile: () => Effect.fail(invalid("The bundle contains an unsupported or oversized file.")),
      FileChangedWhileReading: () => Effect.fail(new SkillConflict({ message: "A file changed while it was being read. Try again." })),
    }),
  );

export const metadata = Effect.fnUntraced(function* (content: string, expectedName?: string) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return yield* invalid("SKILL.md needs YAML frontmatter with a name and description.");
  const value = yield* Effect.try({
    try: () => parse(match[1]!, { maxAliasCount: 0 }) as { name?: unknown; description?: unknown; version?: unknown } | null,
    catch: () => invalid("SKILL.md has invalid YAML frontmatter."),
  });
  const { name, description, version } = value ?? {};
  if (typeof name !== "string") return yield* invalid("SKILL.md needs a name.");
  yield* checkName(name);
  if (expectedName !== undefined && name !== expectedName) return yield* invalid("The name in SKILL.md must match its library folder.");
  if (typeof description !== "string" || !description.trim() || description.length > 1024) {
    return yield* invalid("Give the skill a description between 1 and 1024 characters.");
  }
  return { name, description, ...(typeof version === "string" && version.trim() ? { version: version.trim() } : {}) };
});

type Entry = { path: string; mode: number; file: { bytes: Buffer; digest: string } | null };
export type Guard = (path: string) => Effect.Effect<void, SkillInvalid>;

export const markdown = Effect.fnUntraced(function* (path: string, guard: Guard, expectedName?: string) {
  const file = join(path, "SKILL.md");
  yield* guard(file);
  if ((yield* info(file))?.type !== "File") return yield* invalid("SKILL.md is required and must be a regular file.");
  const { bytes } = yield* readRegular(file, MAX_MARKDOWN_BYTES);
  const content = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: () => invalid("SKILL.md must be UTF-8."),
  });
  return { ...(yield* metadata(content, expectedName)), content, hash: sha256(bytes) };
});

export const readBundle = Effect.fnUntraced(function* (root: string, guard: Guard) {
  const fs = yield* FileSystem.FileSystem;
  const files = new Map<string, Entry>();
  let total = 0;
  const walk = (directory: string, prefix: string, depth: number): Effect.Effect<void, SkillInvalid | SkillConflict | StorageFailure, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      yield* guard(directory);
      if (depth > 32 || !(yield* isDirectory(directory))) return yield* invalid("The bundle must contain regular files and directories only.");
      for (const name of (yield* fs.readDirectory(directory)).sort()) {
        if (name === ".git" || files.size === MAX_FILES) return yield* invalid("The bundle contains repository metadata or too many entries.");
        const path = join(directory, name);
        const relative = prefix + name;
        yield* guard(path);
        const stat = yield* info(path);
        if (stat?.type === "Directory") {
          files.set(relative, { path: relative, mode: stat.mode & 0o777, file: null });
          yield* walk(path, relative + "/", depth + 1);
        } else {
          if (stat?.type !== "File") return yield* invalid("The bundle must contain regular files and directories only.");
          const { bytes, mode } = yield* readRegular(path, Math.min(MAX_BYTES - total, relative === "SKILL.md" ? MAX_MARKDOWN_BYTES : MAX_BYTES));
          total += bytes.length;
          files.set(relative, { path: relative, mode, file: { bytes, digest: sha256(bytes) } });
        }
      }
    });
  yield* walk(root, "", 0);
  const digest = sha256(Buffer.from(JSON.stringify([...files.values()].map(signature))));
  return { files, digest, content: files.get("SKILL.md")?.file?.bytes.toString("utf8") ?? "" };
});

const signature = (entry: Entry) => [entry.path, entry.mode, entry.file?.digest ?? null];

export type Bundle = Effect.Success<ReturnType<typeof readBundle>>;

export const writeBundle = Effect.fnUntraced(function* (root: string, bundle: Bundle, guard: Guard) {
  const fs = yield* FileSystem.FileSystem;
  const directories: Entry[] = [];
  for (const entry of bundle.files.values()) {
    const path = join(root, entry.path);
    yield* guard(path);
    if (entry.file === null) {
      yield* fs.makeDirectory(path);
      directories.unshift(entry);
    } else {
      yield* fs.writeFile(path, entry.file.bytes, { flag: "wx" });
      yield* fs.chmod(path, entry.mode);
    }
  }
  for (const entry of directories) yield* fs.chmod(join(root, entry.path), entry.mode);
});

export function bundleChanges(before: Bundle | null, after: Bundle | null) {
  const paths = new Set([...(before?.files.keys() ?? []), ...(after?.files.keys() ?? [])]);
  return [...paths].sort().flatMap((path): Array<{ path: string; kind: "added" | "removed" | "changed" }> => {
    const old = before?.files.get(path);
    const next = after?.files.get(path);
    if (!old) return [{ path, kind: "added" }];
    if (!next) return [{ path, kind: "removed" }];
    return JSON.stringify(signature(old)) === JSON.stringify(signature(next)) ? [] : [{ path, kind: "changed" }];
  });
}

export function installedBundleDifferences(installed: Bundle, library: Bundle): BundleDifference[] {
  const paths = new Set([...installed.files.keys(), ...library.files.keys()]);
  const differences: BundleDifference[] = [];
  for (const path of [...paths].sort()) {
    const copy = installed.files.get(path);
    const source = library.files.get(path);
    const kinds: Array<BundleDifference["kinds"][number]> = [];
    if (!copy) kinds.push("only library");
    else if (!source) kinds.push("only installed");
    else {
      if ((copy.file === null) !== (source.file === null)) kinds.push("entry type");
      if (copy.file !== null && source.file !== null && copy.file.digest !== source.file.digest) kinds.push("content");
      if (copy.mode !== source.mode) kinds.push("permissions");
    }
    if (kinds.length) differences.push({ path, kinds });
  }
  return differences;
}
