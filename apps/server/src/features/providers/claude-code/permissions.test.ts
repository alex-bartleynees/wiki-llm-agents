import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { VAULT_WRITE_TOOLS } from "../../mcp/vault-tools.js";
import { decide, enforcedAutonomy } from "./permissions.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-claude-permissions-")));
const vault = join(root, "vault");
const outside = join(root, "outside");
const own = join(root, "attachments", "a1");
const others = join(root, "attachments", "b2");
mkdirSync(join(vault, "Notes"), { recursive: true });
mkdirSync(outside);
mkdirSync(own, { recursive: true });
mkdirSync(others, { recursive: true });
writeFileSync(join(own, "sales.csv"), "region,amount\n");
writeFileSync(join(others, "other.csv"), "a,b\n");
writeFileSync(join(vault, "Notes/Tea.md"), "# Tea\n");
writeFileSync(join(outside, "secret.md"), "secret");
symlinkSync(outside, join(vault, "escape"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RESEARCHER: Autonomy = { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow", tools: "allow" };
const TRUSTED: Autonomy = { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "allow", tools: "allow" };

const secrets = join(root, "data", "secrets");
const keyFile = join(root, "state", "secrets.key");
mkdirSync(secrets, { recursive: true });
mkdirSync(join(root, "state"));
writeFileSync(join(secrets, "secrets.enc"), "{}");
writeFileSync(keyFile, "key");
symlinkSync(join(root, "state"), join(vault, "state-link"));

const decision = (toolName: string, toolInput: unknown, autonomy: Autonomy = DEFAULT_AUTONOMY, roots = [vault], readable = [own], protectedPaths = [secrets, keyFile]) =>
  Effect.runPromise(
    decide({ autonomy, roots, readable, protectedPaths, cwd: vault, vaultTools: "wiki-agents-thread-1", toolName, toolInput }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

describe("autonomy → Claude Code tool decisions", () => {
  it("reads inside the vault follow read autonomy; outside, or through a symlink out, they ask", async () => {
    expect(await decision("Read", { file_path: join(vault, "Notes/Tea.md") })).toBe("allow");
    expect(await decision("Read", { file_path: "Notes/Tea.md" })).toBe("allow");
    expect(await decision("Read", { file_path: join(outside, "secret.md") })).toBe("ask");
    expect(await decision("Read", { file_path: join(vault, "escape/secret.md") })).toBe("ask");
    expect(await decision("Glob", { pattern: `${outside}/**/*.md` })).toBe("ask");
    expect(await decision("Read", { file_path: join(vault, "Notes/Tea.md") }, { ...DEFAULT_AUTONOMY, read: "deny" })).toBe("deny");
  });

  it("reads the thread's own attachments as the read autonomy says; writing there, or reading another thread's, asks", async () => {
    expect(await decision("Read", { file_path: join(own, "sales.csv") })).toBe("allow");
    expect(await decision("Grep", { pattern: "north", path: own })).toBe("allow");
    expect(await decision("Read", { file_path: join(own, "sales.csv") }, { ...DEFAULT_AUTONOMY, read: "deny" })).toBe("deny");
    expect(await decision("Read", { file_path: join(others, "other.csv") })).toBe("ask");
    expect(await decision("Edit", { file_path: join(own, "sales.csv"), old_string: "a", new_string: "b" }, TRUSTED)).toBe("ask");
    expect(await decision("Write", { file_path: join(own, "result.csv"), content: "x" }, TRUSTED)).toBe("ask");
  });

  it("tells creating a file from editing one by whether it exists", async () => {
    expect(await decision("Write", { file_path: join(vault, "Notes/New.md"), content: "x" }, RESEARCHER)).toBe("allow");
    expect(await decision("Write", { file_path: join(vault, "Notes/Tea.md"), content: "x" }, RESEARCHER)).toBe("ask");
    expect(await decision("Edit", { file_path: join(vault, "Notes/Tea.md"), old_string: "a", new_string: "b" }, RESEARCHER)).toBe("ask");
    expect(await decision("Write", { file_path: join(vault, "Notes/New.md"), content: "x" }, { ...RESEARCHER, create: "deny" })).toBe("deny");
  });

  it("asks before writing outside the vault even when writes are allowed, and allows a project's other folders", async () => {
    expect(await decision("Write", { file_path: join(outside, "new.md"), content: "x" }, TRUSTED)).toBe("ask");
    expect(await decision("Write", { file_path: join(outside, "new.md"), content: "x" }, TRUSTED, [vault, outside])).toBe("allow");
  });

  it("leaves commands to Claude Code while they ask, and allows or denies them as the autonomy says", async () => {
    expect(await decision("Bash", { command: "ls" })).toBe("defer");
    expect(await decision("Bash", { command: "ls" }, { ...DEFAULT_AUTONOMY, read: "ask" })).toBe("ask");
    expect(await decision("Bash", { command: "ls" }, RESEARCHER)).toBe("deny");
    expect(await decision("Bash", { command: "rm -rf /" }, TRUSTED)).toBe("allow");
    expect(await decision("WebFetch", { url: "https://example.com" }, RESEARCHER)).toBe("allow");
  });

  it("gives the thread's own vault tools read autonomy, denies other threads', and asks for anything else", async () => {
    expect(await decision("mcp__wiki-agents-thread-1__vault_search", { query: "tea" })).toBe("allow");
    expect(await decision("mcp__wiki-agents-thread-2__vault_search", { query: "tea" })).toBe("deny");
    expect(await decision("mcp__github__create_issue", {}, TRUSTED)).toBe("ask");
    expect(await decision("Agent", { prompt: "go" }, TRUSTED)).toBe("ask");
    expect(await decision("AskUserQuestion", { questions: [] }, TRUSTED)).toBe("ask");
    expect(await decision("TodoWrite", { todos: [] })).toBe("allow");
  });

  it("leaves its own vault write approvals to the server, even when read is denied", async () => {
    for (const tool of VAULT_WRITE_TOOLS) {
      expect(await decision(`mcp__wiki-agents-thread-1__${tool}`, {}, { ...DEFAULT_AUTONOMY, read: "deny" })).toBe("allow");
      expect(await decision(`mcp__wiki-agents-thread-2__${tool}`, {}, TRUSTED)).toBe("deny");
    }
  });

  it("leaves other MCP servers' tools on its entry to the server, which checks autonomy itself", async () => {
    const strict = { ...DEFAULT_AUTONOMY, read: "deny" as const, tools: "deny" as const };
    expect(await decision("mcp__wiki-agents-thread-1__github__create_issue", { title: "x" }, strict)).toBe("allow");
    expect(await decision("mcp__wiki-agents-thread-2__github__create_issue", {}, TRUSTED)).toBe("deny");
    expect(await decision("mcp__wiki-agents-thread-1__vault_search", {}, strict)).toBe("deny");
  });

  it("notes where Claude Code's enforcement differs from the file", () => {
    expect(enforcedAutonomy(RESEARCHER)).toEqual({ autonomy: RESEARCHER, notes: [expect.stringContaining("outside the working folder")] });
    expect(enforcedAutonomy(DEFAULT_AUTONOMY).notes).toHaveLength(2);
  });
});

describe("files holding secrets", () => {
  it("denies reading, writing or searching them whatever the autonomy, through a symlink too", async () => {
    expect(await decision("Read", { file_path: join(secrets, "secrets.enc") }, TRUSTED)).toBe("secret");
    expect(await decision("Read", { file_path: keyFile }, TRUSTED)).toBe("secret");
    expect(await decision("Read", { file_path: "state-link/secrets.key" }, TRUSTED)).toBe("secret");
    expect(await decision("Write", { file_path: join(secrets, "new.enc"), content: "x" }, TRUSTED)).toBe("secret");
    expect(await decision("Edit", { file_path: keyFile, old_string: "a", new_string: "b" }, TRUSTED)).toBe("secret");
    expect(await decision("Grep", { pattern: "key", path: join(root, "data") }, TRUSTED)).toBe("secret");
    expect(await decision("Glob", { pattern: `${root}/state/*` }, TRUSTED)).toBe("secret");
  });

  it("denies a command naming one, from the home folder too; other commands follow commands", async () => {
    expect(await decision("Bash", { command: `cat ${keyFile}` }, TRUSTED)).toBe("secret");
    expect(await decision("Bash", { command: `cp -r ${secrets} /tmp/x` })).toBe("secret");
    expect(await decision("Bash", { command: "ls" }, TRUSTED)).toBe("allow");
  });

  it("leaves everything else as before", async () => {
    expect(await decision("Read", { file_path: join(vault, "Notes/Tea.md") })).toBe("allow");
    expect(await decision("Read", { file_path: join(root, "data", "app.db") })).toBe("ask");
    expect(await decision("Grep", { pattern: "north", path: own })).toBe("allow");
  });
});
