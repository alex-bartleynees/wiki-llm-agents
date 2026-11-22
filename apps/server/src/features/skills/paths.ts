import type { Destination, PhysicalDestination, Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isProtectedName, type Protection } from "../../shared/secret-paths.js";
import { isInside } from "../../shared/vault/path-guard.js";
import { checkName, info } from "./bundle.js";
import { SkillProblem } from "./problem.js";

export function canonical(path: string): string {
  if (info(path)) return realpathSync(path);
  return join(canonical(dirname(path)), basename(path));
}

export function configuredPath(input: string, guard: (path: string) => void, home = homedir()) {
  const expanded = input.startsWith("~/") ? join(home, input.slice(2)) : input;
  if (!isAbsolute(expanded) || expanded.includes("\0")) throw new SkillProblem("Use an absolute host path or a path starting with ~/.");
  const written = resolve(expanded);
  guard(written);
  let path: string;
  try {
    path = canonical(written);
  } catch {
    throw new SkillProblem("Could not resolve this folder.");
  }
  guard(path);
  if (dirname(path) === path || path === home) throw new SkillProblem("Choose a dedicated folder.");
  if (info(path) && !info(path)?.isDirectory()) throw new SkillProblem("The path must be a directory.");
  return path;
}

export function pathGuard(protection: Protection) {
  return (path: string) => {
    if (protection.paths.some((protectedPath) => isInside(protectedPath, path)) ||
        path.split("/").some((part) => part && (part === ".git" || isProtectedName(protection.names, part)))) {
      throw new SkillProblem("The path contains protected material.");
    }
  };
}

export function disjoint(paths: readonly string[]) {
  for (const [index, path] of paths.entries()) {
    if (paths.slice(index + 1).some((other) => isInside(path, other) || isInside(other, path))) {
      throw new SkillProblem("Library and destination folders must be separate and cannot contain one another.");
    }
  }
}

export function librarySkill(root: string, skillPath: string, guard: (path: string) => void) {
  const parts = skillPath.split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part.includes("\\") || part.includes("\0"))) {
    throw new SkillProblem("Use a library-relative skill path.");
  }
  const name = parts.pop()!;
  checkName(name);
  let parent = root;
  for (const part of parts) {
    parent = join(parent, part);
    guard(parent);
    if (!info(parent)?.isDirectory()) throw new SkillProblem("The library group is missing or is not a regular directory.", 404);
    if (info(join(parent, "SKILL.md"))) throw new SkillProblem("The selected path is inside a skill bundle.", 404);
  }
  const path = join(parent, name);
  guard(path);
  return { name, parent, path };
}

export function previewPaths(settings: Settings, dataDir: string, home: string, guard: (path: string) => void): SettingsPreview {
  const diagnostics: Array<SettingsPreview["diagnostics"][number]> = [];
  function resolvePath(enteredPath: string, label: string) {
    try {
      return { enteredPath, resolvedPath: configuredPath(enteredPath.trim(), guard, home) };
    } catch (error) {
      if (!(error instanceof SkillProblem)) throw error;
      diagnostics.push({ kind: "invalid", message: label + ": " + error.message });
      return { enteredPath, resolvedPath: null };
    }
  }

  if (settings.destinations.length > 12) diagnostics.push({ kind: "invalid", message: "Configure up to 12 install destinations." });
  const library = resolvePath(settings.library, "Library");
  const destinations = settings.destinations.map(({ label, path }) => {
    if (!label.trim() || label.length > 100) diagnostics.push({ kind: "invalid", message: "Enter a label of up to 100 characters for each destination." });
    return { label: label.trim(), ...resolvePath(path, label.trim() || "Destination") };
  });
  const roots = [
    { label: "App data", resolvedPath: canonical(dataDir), destination: false },
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
  return { library, destinations, diagnostics };
}

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
