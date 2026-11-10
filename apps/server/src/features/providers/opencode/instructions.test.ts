import { describe, expect, it } from "vitest";
import type { Instruction } from "../port.js";
import { instructionsText, loadedByOpenCode } from "./instructions.js";

const rules: Instruction = { source: "rules", title: "rules/wiki-llm.md", path: "/config/rules/wiki-llm.md", text: "RULES" };
const agent: Instruction = { source: "agent", title: "Researcher agent", path: "/config/agents/researcher.md", text: "AGENT\n" };
const vault = (path: string): Instruction => ({ source: "vault", title: "AGENTS.md in the vault", path, text: "VAULT" });

describe("loadedByOpenCode", () => {
  it("is true for an AGENTS.md in the working folder or one of its parents", () => {
    expect(loadedByOpenCode(vault("/vaults/home/AGENTS.md"), "/vaults/home")).toBe(true);
    expect(loadedByOpenCode(vault("/vaults/home/AGENTS.md"), "/vaults/home/1-Active/App")).toBe(true);
  });

  it("is false for other folders and other files", () => {
    expect(loadedByOpenCode(vault("/vaults/work/AGENTS.md"), "/vaults/home")).toBe(false);
    expect(loadedByOpenCode(vault("/vaults/home-two/AGENTS.md"), "/vaults/home")).toBe(false);
    expect(loadedByOpenCode(vault("/vaults/home/sub/AGENTS.md"), "/vaults/home")).toBe(false);
    expect(loadedByOpenCode(rules, "/config")).toBe(false);
  });
});

describe("instructionsText", () => {
  it("keeps the order and labels each part with where it came from", () => {
    const text = instructionsText([rules, agent], "/vaults/home")!;
    expect(text.indexOf("RULES")).toBeLessThan(text.indexOf("AGENT"));
    expect(text).toContain('<instructions source="rules/wiki-llm.md">\nRULES\n</instructions>');
    expect(text).toContain('<instructions source="Researcher agent">\nAGENT\n</instructions>');
  });

  it("leaves out the vault's AGENTS.md when OpenCode reads it itself, and keeps another vault's", () => {
    expect(instructionsText([rules, vault("/vaults/home/AGENTS.md")], "/vaults/home")).not.toContain("VAULT");
    expect(instructionsText([rules, vault("/vaults/home/AGENTS.md")], "/projects/app")).toContain("VAULT");
  });

  it("is null when there is nothing to send", () => {
    expect(instructionsText([], "/vaults/home")).toBeNull();
    expect(instructionsText([vault("/vaults/home/AGENTS.md")], "/vaults/home")).toBeNull();
  });
});
