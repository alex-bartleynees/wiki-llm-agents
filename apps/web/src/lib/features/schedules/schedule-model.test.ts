import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
import { describe, expect, it } from "vitest";
import { modelPlaceholder, modelSource } from "./schedule-model.ts";

const provider = (id: string, models = true): ProviderInstance => ({
  id,
  kind: id,
  name: id === "opencode" ? "OpenCode" : id === "claude" ? "Claude Code" : "Replay",
  capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models },
});
const providers = [provider("opencode"), provider("claude"), provider("replay", false)];

const agent = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  id: "scout",
  name: "Scout",
  description: "Looks.",
  provider: null,
  model: null,
  sources: [],
  autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "ask" },
  path: "/config/agents/scout.md",
  enforcement: [],
  ...overrides,
});

describe("modelSource", () => {
  it("uses the schedule's provider when one is picked", () => {
    expect(modelSource("claude", agent({ provider: "opencode" }), providers).provider?.id).toBe("claude");
  });

  it("falls back to the agent's provider, then the first configured one", () => {
    expect(modelSource("", agent({ provider: "claude" }), providers).provider?.id).toBe("claude");
    expect(modelSource("", agent(), providers).provider?.id).toBe("opencode");
    expect(modelSource("", undefined, providers).provider?.id).toBe("opencode");
  });

  it("has no provider before the providers load", () => {
    expect(modelSource("", undefined, []).provider).toBeUndefined();
  });

  it("applies the agent's model on its own provider, or any provider when it names none", () => {
    expect(modelSource("", agent({ provider: "claude", model: "opus" }), providers).agentModel).toBe("opus");
    expect(modelSource("claude", agent({ provider: "claude", model: "opus" }), providers).agentModel).toBe("opus");
    expect(modelSource("claude", agent({ model: "big-pickle" }), providers).agentModel).toBe("big-pickle");
  });

  it("drops the agent's model on another provider, or one without a model choice", () => {
    expect(modelSource("opencode", agent({ provider: "claude", model: "opus" }), providers).agentModel).toBeNull();
    expect(modelSource("replay", agent({ model: "opus" }), providers).agentModel).toBeNull();
  });
});

describe("modelPlaceholder", () => {
  it("names the agent's model when it applies", () => {
    expect(modelPlaceholder(modelSource("", agent({ provider: "claude", model: "opus" }), providers), "sonnet")).toBe("The agent's (opus)");
  });

  it("names the provider and its default", () => {
    expect(modelPlaceholder(modelSource("", undefined, providers), "opencode/big-pickle")).toBe("OpenCode's default (opencode/big-pickle)");
    expect(modelPlaceholder(modelSource("claude", undefined, providers), null)).toBe("Claude Code's default");
  });

  it("says when the provider has no model choice, or isn't known yet", () => {
    expect(modelPlaceholder(modelSource("replay", undefined, providers), null)).toBe("Replay has no model choice");
    expect(modelPlaceholder(modelSource("", undefined, []), null)).toBe("The provider's default");
  });
});
