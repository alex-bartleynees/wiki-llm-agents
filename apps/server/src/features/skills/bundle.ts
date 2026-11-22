import type { BundleDifference } from "@wiki-agents/contracts/skills/model";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { sha256 } from "../../shared/config-files.js";
import { SkillProblem } from "./problem.js";

const MAX_FILES = 1000;
const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 256 * 1024;
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkName(name: string) {
  if (name.length > 64 || !namePattern.test(name)) throw new SkillProblem("Use up to 64 lowercase letters, digits and single hyphens for the skill name.");
}

export function info(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function readRegular(path: string, limit: number) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new SkillProblem("The bundle contains an unsupported or oversized file.");
    const bytes = Buffer.alloc(stat.size + 1);
    const count = readSyncBounded(fd, bytes);
    if (count !== stat.size) throw new SkillProblem("A file changed while it was being read. Try again.", 409);
    return { bytes: bytes.subarray(0, count), mode: stat.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
}

function readSyncBounded(fd: number, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(fd, bytes, offset, bytes.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  return offset;
}

export function metadata(content: string, expectedName?: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) throw new SkillProblem("SKILL.md needs YAML frontmatter with a name and description.");
  let value: { name?: unknown; description?: unknown; version?: unknown } | null;
  try {
    value = parse(match[1]!, { maxAliasCount: 0 }) as typeof value;
  } catch {
    throw new SkillProblem("SKILL.md has invalid YAML frontmatter.");
  }
  const { name, description, version } = value ?? {};
  if (typeof name !== "string") throw new SkillProblem("SKILL.md needs a name.");
  checkName(name);
  if (expectedName !== undefined && name !== expectedName) throw new SkillProblem("The name in SKILL.md must match its library folder.");
  if (typeof description !== "string" || !description.trim() || description.length > 1024) {
    throw new SkillProblem("Give the skill a description between 1 and 1024 characters.");
  }
  return { name, description, ...(typeof version === "string" && version.trim() ? { version: version.trim() } : {}) };
}

type Entry = { path: string; mode: number; bytes: Buffer | null };
export type Guard = (path: string) => void;

export function markdown(path: string, guard: Guard, expectedName?: string) {
  const file = join(path, "SKILL.md");
  guard(file);
  if (!info(file)?.isFile()) throw new SkillProblem("SKILL.md is required and must be a regular file.");
  const { bytes } = readRegular(file, MAX_MARKDOWN_BYTES);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SkillProblem("SKILL.md must be UTF-8.");
  }
  return { ...metadata(content, expectedName), content, hash: sha256(bytes) };
}

export function readBundle(root: string, guard: Guard) {
  const files = new Map<string, Entry>();
  let total = 0;
  function walk(directory: string, prefix: string, depth: number) {
    guard(directory);
    if (depth > 32 || !info(directory)?.isDirectory()) throw new SkillProblem("The bundle must contain regular files and directories only.");
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git" || files.size === MAX_FILES) throw new SkillProblem("The bundle contains repository metadata or too many entries.");
      const path = join(directory, name);
      const relative = prefix + name;
      guard(path);
      const stat = info(path);
      if (stat?.isDirectory()) {
        files.set(relative, { path: relative, mode: stat.mode & 0o777, bytes: null });
        walk(path, relative + "/", depth + 1);
      } else {
        if (!stat?.isFile()) throw new SkillProblem("The bundle must contain regular files and directories only.");
        const file = readRegular(path, Math.min(MAX_BYTES - total, relative === "SKILL.md" ? MAX_MARKDOWN_BYTES : MAX_BYTES));
        total += file.bytes.length;
        files.set(relative, { path: relative, ...file });
      }
    }
  }
  walk(root, "", 0);
  const digest = sha256(Buffer.from(JSON.stringify([...files.values()].map(signature))));
  return { files, digest, content: files.get("SKILL.md")?.bytes?.toString("utf8") ?? "" };
}

function signature(entry: Entry) {
  return [entry.path, entry.mode, entry.bytes === null ? null : sha256(entry.bytes)];
}

export type Bundle = ReturnType<typeof readBundle>;

export function writeBundle(root: string, bundle: Bundle, guard: Guard) {
  const directories: Entry[] = [];
  for (const entry of bundle.files.values()) {
    const path = join(root, entry.path);
    guard(path);
    if (entry.bytes === null) {
      mkdirSync(path);
      directories.unshift(entry);
    } else {
      writeFileSync(path, entry.bytes, { flag: "wx" });
      chmodSync(path, entry.mode);
    }
  }
  for (const entry of directories) chmodSync(join(root, entry.path), entry.mode);
}

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
      if ((copy.bytes === null) !== (source.bytes === null)) kinds.push("entry type");
      if (copy.bytes !== null && source.bytes !== null && !copy.bytes.equals(source.bytes)) kinds.push("content");
      if (copy.mode !== source.mode) kinds.push("permissions");
    }
    if (kinds.length) differences.push({ path, kinds });
  }
  return differences;
}
