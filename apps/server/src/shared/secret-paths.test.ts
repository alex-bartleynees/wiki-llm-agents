import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { commandNamesProtected, DEFAULT_PROTECTED_PATHS, isProtectedName, parseProtectedPaths, type Protection, reachesProtected } from "./secret-paths.js";

const ENV = parseProtectedPaths(DEFAULT_PROTECTED_PATHS).names;

describe("WIKI_AGENTS_PROTECTED_PATHS", () => {
  it("defaults to .env and .env.* except .env.example", () => {
    expect(parseProtectedPaths(DEFAULT_PROTECTED_PATHS)).toEqual({ paths: [], names: [".env", ".env.*", "!.env.example"], problems: [] });
  });

  it("takes paths, ~ paths, name patterns and exceptions, and reports the rest", () => {
    const parsed = parseProtectedPaths("/srv/app/secrets, ~/.aws\n*.pem, !public.pem,app/.env, /srv/*.key, ", "/home/me");
    expect(parsed.paths).toEqual(["/srv/app/secrets", "/home/me/.aws"]);
    expect(parsed.names).toEqual(["*.pem", "!public.pem"]);
    expect(parsed.problems).toEqual([expect.stringContaining('"app/.env"'), expect.stringContaining('"/srv/*.key"')]);
  });

  it("is empty for an empty value", () => {
    expect(parseProtectedPaths("")).toEqual({ paths: [], names: [], problems: [] });
  });
});

describe("protected names", () => {
  it("match a whole name, not part of one, minus the exceptions", () => {
    expect(isProtectedName(ENV, ".env")).toBe(true);
    expect(isProtectedName(ENV, ".env.local")).toBe(true);
    expect(isProtectedName(ENV, ".env.example")).toBe(false);
    expect(isProtectedName(ENV, ".envrc")).toBe(false);
    expect(isProtectedName(ENV, "app.env")).toBe(false);
    expect(isProtectedName(["*.pem"], "server.pem")).toBe(true);
  });

  const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-secret-paths-")));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", ".env"), "KEY=x\n");
  symlinkSync(join(root, "app", ".env"), join(root, "app", "settings"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const reaches = (protection: Protection, cwd: string, paths: ReadonlyArray<string>) =>
    Effect.runPromise(reachesProtected(protection, cwd, paths).pipe(Effect.provide(NodeFileSystem.layer)));

  it("protect the file, a folder with the name, and a symlink to one", async () => {
    const protection = { paths: [], names: ENV };
    expect(await reaches(protection, join(root, "app"), [".env"])).toBe(true);
    expect(await reaches(protection, root, ["app/.env.local"])).toBe(true);
    expect(await reaches(protection, root, [".env/values"])).toBe(true);
    expect(await reaches(protection, join(root, "app"), ["settings"])).toBe(true);
    expect(await reaches(protection, root, ["app/.env.example", "app"])).toBe(false);
  });

  it("don't count the folders above the working folder", async () => {
    const above = join(root, ".env.d");
    mkdirSync(join(above, "work"), { recursive: true });
    expect(await reaches({ paths: [], names: [".env.*"] }, join(above, "work"), ["notes.md"])).toBe(false);
    expect(await reaches({ paths: [], names: [".env.*"] }, root, [join(above, "work", "notes.md")])).toBe(true);
  });
});

describe("commands naming a protected file", () => {
  const protection = { paths: ["/home/me/.aws"], names: ENV };
  const names = (command: string) => commandNamesProtected(protection, command, "/home/me");

  it("catch the name in any word, path or option, and through a glob", () => {
    expect(names("cat .env")).toBe(true);
    expect(names('grep KEY "app/.env.local"')).toBe(true);
    expect(names("set -a; . ./.env; set +a")).toBe(true);
    expect(names("docker compose --env-file=.env.prod up")).toBe(true);
    expect(names("cat .e*")).toBe(true);
    expect(names("tar cz .[a-z]*")).toBe(true);
    expect(names("cat ~/.aws/credentials")).toBe(true);
  });

  it("leave other commands alone", () => {
    expect(names("cat .env.example")).toBe(false);
    expect(names("ls -la *")).toBe(false);
    expect(names("echo $NODE_ENV && npm run env:check")).toBe(false);
    expect(names("direnv allow .envrc")).toBe(false);
  });

  it("don't take a quoted pattern for a glob, but still catch a quoted name", () => {
    expect(names("sed -i '152s/.*/x/' src/Settings.svelte")).toBe(false);
    expect(names('sed -i "96s|.*|answered|" notes.md')).toBe(false);
    expect(names("rg 'const .* = ' src")).toBe(false);
    expect(names("ls .*")).toBe(true);
    expect(names("sed 's/.*/x/' .env")).toBe(true);
    expect(names("cat '.env'")).toBe(true);
    expect(names('grep KEY "app/.env.local"')).toBe(true);
    expect(names("cat \\.env")).toBe(true);
  });
});
