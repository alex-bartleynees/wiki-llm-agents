import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { NO_PROTECTION, type Protection } from "../../../shared/secret-paths.js";
import { autonomyConfig, codexNameGlobs, decideCommand, decideFileChange, enforcedAutonomy, PERMISSION_PROFILE, permissionsReachProtected } from "./permissions.js";
import type { FileUpdateChange } from "./protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-codex-permissions-")));
const vault = join(root, "vault");
const outside = join(root, "outside");
mkdirSync(join(vault, "Notes"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(vault, "Notes/Tea.md"), "# Tea\n");
symlinkSync(outside, join(vault, "escape"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RESEARCHER: Autonomy = { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow", tools: "allow", subagents: "ask" };
const TRUSTED: Autonomy = { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "allow", tools: "allow", subagents: "allow" };

const add = (path: string): FileUpdateChange => ({ path, kind: { type: "add" }, diff: "x\n" });
const update = (path: string, movePath: string | null = null): FileUpdateChange => ({ path, kind: { type: "update", move_path: movePath }, diff: "@@ -1 +1 @@\n-a\n+b\n" });
const remove = (path: string): FileUpdateChange => ({ path, kind: { type: "delete" }, diff: "x\n" });

const secrets = join(root, "data", "secrets");
const keyFile = join(root, "state", "secrets.key");

const ENV_NAMES = [".env", ".env.*", "!.env.example"];
const only = (paths: ReadonlyArray<string>): Protection => ({ paths, names: [] });

const decision = (changes: ReadonlyArray<FileUpdateChange>, autonomy: Autonomy = DEFAULT_AUTONOMY, roots = [vault], protection: Protection = { paths: [secrets, keyFile], names: ENV_NAMES }) =>
  Effect.runPromise(decideFileChange({ autonomy, roots, cwd: vault, changes, protection }).pipe(Effect.provide(NodeFileSystem.layer)));

describe("autonomy → Codex patch decisions", () => {
  it("tells creating a file from editing one, and takes the strictest of a patch's files", async () => {
    expect(await decision([add(join(vault, "Notes/New.md"))], RESEARCHER)).toBe("allow");
    expect(await decision([update(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([remove(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([add(join(vault, "Notes/New.md")), update(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    // Adding over a file that exists replaces it: that's editing.
    expect(await decision([add(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([add("Notes/New.md")], { ...RESEARCHER, create: "deny" })).toBe("deny");
  });

  it("asks for files outside the working folder, through a symlink out, or moved out, whatever the autonomy says", async () => {
    expect(await decision([update(join(vault, "Notes/Tea.md"))], TRUSTED)).toBe("allow");
    expect(await decision([add(join(outside, "x.md"))], TRUSTED)).toBe("ask");
    expect(await decision([add(join(vault, "escape/x.md"))], TRUSTED)).toBe("ask");
    expect(await decision([update(join(vault, "Notes/Tea.md"), join(outside, "Tea.md"))], TRUSTED)).toBe("ask");
    // A project's other directories count as inside.
    expect(await decision([add(join(outside, "x.md"))], TRUSTED, [vault, outside])).toBe("allow");
    expect(await decision([add(join(outside, "x.md"))], { ...TRUSTED, create: "deny" })).toBe("deny");
  });

  it("asks when Codex names no files", async () => {
    expect(await decision([], TRUSTED)).toBe("ask");
  });

  it("answers commands outside the sandbox from commands autonomy", () => {
    expect(decideCommand(DEFAULT_AUTONOMY, only([keyFile]), "npm install")).toBe("ask");
    expect(decideCommand(RESEARCHER, only([keyFile]), "npm install")).toBe("deny");
    expect(decideCommand(TRUSTED, only([keyFile]), "npm install")).toBe("allow");
  });

  it("turns web search on only when the web is allowed, and says what Codex can't enforce", () => {
    expect(autonomyConfig(RESEARCHER, NO_PROTECTION, [vault])).toMatchObject({ web_search: "live" });
    expect(autonomyConfig(DEFAULT_AUTONOMY, NO_PROTECTION, [vault])).toMatchObject({ web_search: "disabled" });
    const enforced = enforcedAutonomy({ ...DEFAULT_AUTONOMY, read: "ask" });
    expect(enforced.autonomy).toEqual({ ...DEFAULT_AUTONOMY, read: "allow", web: "deny", subagents: "allow" });
    expect(enforced.notes.join("\n")).toMatch(/reading is always allowed/);
    expect(enforced.notes.join("\n")).toMatch(/can't ask before it searches the web/);
    expect(enforced.notes.join("\n")).toMatch(/starts its subagents without asking/);
    expect(enforcedAutonomy(TRUSTED).autonomy).toEqual(TRUSTED);
  });
});

describe("files holding secrets", () => {
  it("denies a patch touching one whatever the autonomy", async () => {
    expect(await decision([add(join(secrets, "x.enc"))], TRUSTED)).toBe("deny");
    expect(await decision([update(join(vault, "Notes/Tea.md"), keyFile)], TRUSTED)).toBe("deny");
    expect(await decision([update(join(vault, "Notes/Tea.md"))], TRUSTED)).toBe("allow");
  });

  it("denies a command outside the sandbox that names one, and access asked for one", () => {
    expect(decideCommand(TRUSTED, only([keyFile]), `cat ${keyFile}`)).toBe("deny");
    expect(permissionsReachProtected(only([secrets]), { fileSystem: { entries: [{ access: "read", path: { type: "path", path: join(secrets, "secrets.enc") } }] } })).toBe(true);
    expect(permissionsReachProtected(only([secrets]), { fileSystem: { write: [vault] } })).toBe(false);
  });

  it("runs the thread under a profile that reads everything but them", () => {
    expect(autonomyConfig(TRUSTED, only([secrets, keyFile]), [vault])).toMatchObject({
      default_permissions: PERMISSION_PROFILE,
      [`permissions.${PERMISSION_PROFILE}.filesystem`]: { ":root": "read", [secrets]: "none", [keyFile]: "none" },
    });
    expect(autonomyConfig(TRUSTED, NO_PROTECTION, [vault])).not.toHaveProperty("default_permissions");
  });
});

describe("protected names (.env)", () => {
  it("cuts the exceptions out of a pattern as deny-only globs", () => {
    expect(codexNameGlobs(".env", ["env.example"])).toEqual([".env"]);
    expect(codexNameGlobs(".env.*", [])).toEqual([".env.*"]);
    expect(codexNameGlobs(".env.*", [".env.ex"])).toEqual([".env.", ".env.[!e]*", ".env.e", ".env.e[!x]*", ".env.ex?*"]);
    expect(codexNameGlobs(".env.*", [".env.ab", ".env.ac"])).toEqual([".env.", ".env.[!a]*", ".env.a", ".env.a[!bc]*", ".env.ab?*", ".env.ac?*"]);
    // A glob exception can't be cut out: the pattern stays whole, the stricter way round.
    expect(codexNameGlobs(".env.*", [".env.*.example"])).toEqual([".env.*"]);
  });

  it("denies the patterns below every root, and the paths, in the profile", () => {
    const filesystem = autonomyConfig(TRUSTED, { paths: [keyFile], names: ENV_NAMES }, [vault, vault, outside])[`permissions.${PERMISSION_PROFILE}.filesystem`] as Record<string, string>;
    expect(filesystem).toMatchObject({ ":root": "read", [keyFile]: "none", [`${vault}/**/.env`]: "none", [`${outside}/**/.env.`]: "none", [`${vault}/**/.env.example?*`]: "none" });
    expect(Object.keys(filesystem).filter((key) => key.startsWith(vault))).toHaveLength(16);
    expect(Object.values(filesystem).filter((access) => access !== "none")).toEqual(["read"]);
  });

  it("denies a patch or a command outside the sandbox reaching one, but not .env.example", async () => {
    expect(await decision([add(join(vault, ".env"))], TRUSTED)).toBe("deny");
    expect(await decision([update(join(vault, "app", ".env.production"))], TRUSTED)).toBe("deny");
    expect(await decision([add(join(vault, ".env.example"))], TRUSTED)).toBe("allow");
    expect(decideCommand(TRUSTED, { paths: [], names: ENV_NAMES }, "cp .env.example .env")).toBe("deny");
    expect(decideCommand(TRUSTED, { paths: [], names: ENV_NAMES }, "cat .env.example")).toBe("allow");
  });
});
