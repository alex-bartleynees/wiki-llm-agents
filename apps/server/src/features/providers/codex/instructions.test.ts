import { describe, expect, it } from "vitest";
import type { Instruction } from "../port.js";
import { developerInstructions, findGitRoot, loadedByCodex } from "./instructions.js";

const rules: Instruction = { source: "rules", title: "rules/wiki-llm.md", path: "/config/rules/wiki-llm.md", text: "RULES" };
const agent: Instruction = { source: "agent", title: "Researcher agent", path: "/config/agents/researcher.md", text: "AGENT\n" };
const vault = (path: string): Instruction => ({ source: "vault", title: "AGENTS.md in the vault", path, text: "VAULT" });

describe("Codex instructions", () => {
  it("leaves out an AGENTS.md Codex reads itself: in the folder, or above it inside its git repository", () => {
    expect(loadedByCodex(vault("/vaults/home/AGENTS.md"), "/vaults/home", null)).toBe(true);
    expect(loadedByCodex(vault("/vaults/home/AGENTS.md"), "/vaults/home/Projects", null)).toBe(false);
    expect(loadedByCodex(vault("/vaults/home/AGENTS.md"), "/vaults/home/Projects", "/vaults/home")).toBe(true);
    expect(loadedByCodex(vault("/vaults/AGENTS.md"), "/vaults/home/Projects", "/vaults/home")).toBe(false);
    expect(loadedByCodex(vault("/vaults/home/CLAUDE.md"), "/vaults/home", null)).toBe(false);
    expect(loadedByCodex(vault("/vaults/home/AGENTS.md"), "/code/app", "/code/app")).toBe(false);
  });

  it("sends the rest in order, or nothing", () => {
    const text = developerInstructions([rules, agent, vault("/vaults/home/AGENTS.md")], "/code/app", null) ?? "";
    expect(text.indexOf("RULES")).toBeLessThan(text.indexOf("AGENT"));
    expect(text).toContain('<instructions source="AGENTS.md in the vault">\nVAULT\n</instructions>');
    expect(developerInstructions([vault("/vaults/home/AGENTS.md")], "/vaults/home", null)).toBeNull();
  });

  it("finds the git repository holding a folder", () => {
    const repos = new Set(["/code/app/.git"]);
    expect(findGitRoot("/code/app/src/lib", (path) => repos.has(path))).toBe("/code/app");
    expect(findGitRoot("/vaults/home", (path) => repos.has(path))).toBeNull();
  });
});
