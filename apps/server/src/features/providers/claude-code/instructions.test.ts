import { describe, expect, it } from "vitest";
import type { Instruction } from "../port.js";
import { appendedPrompt, loadedByClaudeCode } from "./instructions.js";

const rules: Instruction = { source: "rules", title: "rules/wiki-llm.md", path: "/config/rules/wiki-llm.md", text: "RULES" };
const agent: Instruction = { source: "agent", title: "Researcher agent", path: "/config/agents/researcher.md", text: "AGENT\n" };
const vault = (path: string): Instruction => ({ source: "vault", title: "AGENTS.md in the vault", path, text: "VAULT" });

describe("Claude Code instructions", () => {
  it("leaves out an AGENTS.md or CLAUDE.md that Claude Code reads itself", () => {
    expect(loadedByClaudeCode(vault("/vaults/home/AGENTS.md"), "/vaults/home/Projects")).toBe(true);
    expect(loadedByClaudeCode(vault("/vaults/home/CLAUDE.md"), "/vaults/home")).toBe(true);
    expect(loadedByClaudeCode(vault("/vaults/home/AGENTS.md"), "/code/app")).toBe(false);
    expect(loadedByClaudeCode(rules, "/config")).toBe(false);
  });

  it("appends the rest in order, or nothing", () => {
    const text = appendedPrompt([rules, agent, vault("/vaults/home/AGENTS.md")], "/code/app") ?? "";
    expect(text.indexOf("RULES")).toBeLessThan(text.indexOf("AGENT"));
    expect(text).toContain('<instructions source="AGENTS.md in the vault">\nVAULT\n</instructions>');
    expect(appendedPrompt([vault("/vaults/home/AGENTS.md")], "/vaults/home")).toBeNull();
  });
});
