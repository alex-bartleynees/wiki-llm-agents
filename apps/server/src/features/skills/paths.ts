import type { Destination, PhysicalDestination, Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, FileSystem, type PlatformError } from "effect";
import { isProtectedName, type Protection } from "../../shared/secret-paths.js";
import { isInside } from "../../shared/vault/path-guard.js";
import { checkName, type Guard, info, isDirectory } from "./bundle.js";
import { SkillInvalid, SkillNotFound } from "./errors.js";

const invalid = (message: string) => new SkillInvalid({ message });

export const canonical = (path: string): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (yield* info(path)) return yield* fs.realPath(path);
    return join(yield* canonical(dirname(path)), basename(path));
  });

export const configuredPath = Effect.fnUntraced(function* (input: string, guard: Guard, home = homedir()) {
  const expanded = input.startsWith("~/") ? join(home, input.slice(2)) : input;
  if (!isAbsolute(expanded) || expanded.includes("\0")) return yield* invalid("Use an absolute host path or a path starting with ~/.");
  const written = resolve(expanded);
  yield* guard(written);
  const path = yield* canonical(written).pipe(Effect.mapError(() => invalid("Could not resolve this folder.")));
  yield* guard(path);
  if (dirname(path) === path || path === home) return yield* invalid("Choose a dedicated folder.");
  const stat = yield* info(path);
  if (stat !== undefined && stat.type !== "Directory") return yield* invalid("The path must be a directory.");
  return path;
});

export const pathGuard = (protection: Protection): Guard => (path) =>
  Effect.suspend(() =>
    protection.paths.some((protectedPath) => isInside(protectedPath, path)) ||
    path.split("/").some((part) => part && (part === ".git" || isProtectedName(protection.names, part)))
      ? Effect.fail(invalid("The path contains protected material."))
      : Effect.void,
  );

export const disjoint = (paths: readonly string[]) =>
  paths.some((path, index) => paths.slice(index + 1).some((other) => isInside(path, other) || isInside(other, path)))
    ? Effect.fail(invalid("Library and destination folders must be separate and cannot contain one another."))
    : Effect.void;

export const librarySkill = Effect.fnUntraced(function* (root: string, skillPath: string, guard: Guard) {
  const parts = skillPath.split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part.includes("\\") || part.includes("\0"))) {
    return yield* invalid("Use a library-relative skill path.");
  }
  const name = parts.pop()!;
  yield* checkName(name);
  let parent = root;
  for (const part of parts) {
    parent = join(parent, part);
    yield* guard(parent);
    if (!(yield* isDirectory(parent))) return yield* new SkillNotFound({ message: "The library group is missing or is not a regular directory." });
    if (yield* info(join(parent, "SKILL.md"))) return yield* new SkillNotFound({ message: "The selected path is inside a skill bundle." });
  }
  const path = join(parent, name);
  yield* guard(path);
  return { name, parent, path };
});

export const previewPaths = Effect.fnUntraced(function* (settings: Settings, dataDir: string, home: string, guard: Guard) {
  const diagnostics: Array<SettingsPreview["diagnostics"][number]> = [];
  const resolvePath = (enteredPath: string, label: string) =>
    configuredPath(enteredPath.trim(), guard, home).pipe(
      Effect.catchTag("SkillInvalid", (error) =>
        Effect.sync(() => {
          diagnostics.push({ kind: "invalid", message: label + ": " + error.message });
          return null;
        }),
      ),
      Effect.map((resolvedPath) => ({ enteredPath, resolvedPath })),
    );

  if (settings.destinations.length > 12) diagnostics.push({ kind: "invalid", message: "Configure up to 12 install destinations." });
  const library = yield* resolvePath(settings.library, "Library");
  const destinations = yield* Effect.forEach(settings.destinations, ({ label, path }) =>
    Effect.gen(function* () {
      if (!label.trim() || label.length > 100) diagnostics.push({ kind: "invalid", message: "Enter a label of up to 100 characters for each destination." });
      return { label: label.trim(), ...(yield* resolvePath(path, label.trim() || "Destination")) };
    }),
  );
  const roots = [
    { label: "App data", resolvedPath: yield* canonical(dataDir), destination: false },
    { label: "Library", resolvedPath: library.resolvedPath, destination: false },
    ...destinations.map((entry) => ({ ...entry, destination: true })),
  ];
  for (const [index, root] of roots.entries()) {
    for (const other of roots.slice(index + 1)) {
      const a = root.resolvedPath;
      const b = other.resolvedPath;
      if (a === null || b === null) continue;
      if (a === b && root.destination && other.destination) {
        diagnostics.push({ kind: "alias", message: root.label + " and " + other.label + " share one physical install destination." });
      } else if (isInside(a, b) || isInside(b, a)) {
        diagnostics.push({ kind: "overlap", message: root.label + " and " + other.label + " overlap. Choose separate folders." });
      }
    }
  }
  return { library, destinations, diagnostics } satisfies SettingsPreview;
});

export function physicalDestinations(destinations: readonly Destination[]): PhysicalDestination[] {
  const groups = new Map<string, Set<string>>();
  for (const { label, path, resolvedPath } of destinations) {
    const root = resolvedPath ?? path;
    const labels = groups.get(root) ?? new Set<string>();
    labels.add(label);
    groups.set(root, labels);
  }
  return [...groups].map(([path, labels]) => ({ path, labels: [...labels] }));
}
