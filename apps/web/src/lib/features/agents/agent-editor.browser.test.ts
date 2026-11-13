import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#lib/api/client.ts";

/** The agent and rules editor stores with real Svelte state; the API is a stand-in. */

const api = vi.hoisted(() => ({
  getAgent: vi.fn(),
  saveAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getRules: vi.fn(),
  saveRules: vi.fn(),
  deleteRules: vi.fn(),
  listAgents: vi.fn(),
}));
vi.mock("./api.ts", () => api);

const { AgentEditor } = await import("./agent-editor.svelte.ts");
const { RulesEditor } = await import("./rules-editor.svelte.ts");

const summary = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  id: "scout",
  name: "Scout",
  description: "Looks.",
  provider: null,
  model: null,
  sources: [],
  autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "ask" },
  concurrency: 1,
  path: "/config/agents/scout.md",
  enforcement: [],
  ...overrides,
});
const version = (hash: string, overrides: Partial<AgentSummary> = {}, instructions = "Look.") => ({ agent: summary(overrides), instructions, hash });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.listAgents.mockResolvedValue({ configDir: "/config", agents: [], rules: [], problems: [] });
});

describe("agent editor", () => {
  it("names a new agent's file after it until the file name is typed, and saves it as new", async () => {
    const editor = new AgentEditor(null);
    editor.setName("Code Reviewer");
    expect(editor.id).toBe("code-reviewer");
    editor.setId("reviewer-2");
    editor.setName("Something else");
    expect(editor.id).toBe("reviewer-2");

    editor.form.instructions = "Review.";
    api.saveAgent.mockResolvedValue(version("h1", { id: "reviewer-2", name: "Something else" }, "Review."));
    expect(await editor.save()).toBe(true);
    expect(api.saveAgent).toHaveBeenCalledWith("reviewer-2", { agent: expect.objectContaining({ name: "Something else", instructions: "Review." }), baseHash: null });
    expect(editor.savedId).toBe("reviewer-2");
    expect(editor.dirty).toBe(false);
  });

  it("saves edits against the hash it loaded, then the one it saved", async () => {
    api.getAgent.mockResolvedValue(version("h0"));
    const editor = new AgentEditor("scout");
    await editor.load();
    expect(editor.status).toBe("ready");
    expect(editor.dirty).toBe(false);

    editor.form.autonomy.edit = "deny";
    expect(editor.changed).toEqual(["autonomy"]);
    api.saveAgent.mockResolvedValueOnce(version("h1", { autonomy: { ...summary().autonomy, edit: "deny" } }));
    await editor.save();
    expect(api.saveAgent).toHaveBeenLastCalledWith("scout", { agent: expect.objectContaining({ autonomy: expect.objectContaining({ edit: "deny" }) }), baseHash: "h0" });

    editor.form.description = "Looks hard.";
    api.saveAgent.mockResolvedValueOnce(version("h2", { description: "Looks hard." }));
    await editor.save();
    expect(api.saveAgent).toHaveBeenLastCalledWith("scout", expect.objectContaining({ baseHash: "h1" }));
  });

  it("files a refusal's problems under their fields", async () => {
    const editor = new AgentEditor(null);
    api.saveAgent.mockRejectedValue(new ApiError(422, "name: Give the agent a name.\ninstructions: Write what the agent should do."));
    expect(await editor.save()).toBe(false);
    expect(editor.problems).toEqual({ name: ["Give the agent a name."], instructions: ["Write what the agent should do."] });
  });

  it("shows a change on disk as a conflict; keeping mine saves over the disk's hash", async () => {
    api.getAgent.mockResolvedValueOnce(version("h0"));
    const editor = new AgentEditor("scout");
    await editor.load();
    editor.form.description = "Mine.";

    api.saveAgent.mockRejectedValueOnce(new ApiError(409, "changed"));
    api.getAgent.mockResolvedValueOnce(version("h-disk", { description: "Theirs." }));
    expect(await editor.save()).toBe(false);
    expect(editor.conflict?.disk).toEqual({ input: expect.objectContaining({ description: "Theirs." }), hash: "h-disk" });
    expect(editor.form.description).toBe("Mine.");

    api.saveAgent.mockResolvedValueOnce(version("h2", { description: "Mine." }));
    expect(await editor.keepMine()).toBe(true);
    expect(api.saveAgent).toHaveBeenLastCalledWith("scout", { agent: expect.objectContaining({ description: "Mine." }), baseHash: "h-disk" });
    expect(editor.conflict).toBeNull();
  });

  it("takes the disk's version, or becomes new again when the file was deleted", async () => {
    api.getAgent.mockResolvedValueOnce(version("h0"));
    const editor = new AgentEditor("scout");
    await editor.load();
    editor.form.description = "Mine.";
    api.saveAgent.mockRejectedValue(new ApiError(409, "changed"));
    api.getAgent.mockResolvedValueOnce(version("h-disk", { description: "Theirs." }));
    await editor.save();
    editor.useDisk();
    expect(editor.form.description).toBe("Theirs.");
    expect(editor.dirty).toBe(false);

    editor.form.description = "Mine again.";
    api.getAgent.mockRejectedValueOnce(new ApiError(404, "gone"));
    await editor.save();
    expect(editor.conflict).toEqual({ disk: null });
    api.saveAgent.mockResolvedValueOnce(version("h3", { description: "Mine again." }));
    await editor.keepMine();
    expect(api.saveAgent).toHaveBeenLastCalledWith("scout", expect.objectContaining({ baseHash: null }));
  });

  it("deletes against the hash it loaded, and turns a 409 into a conflict", async () => {
    api.getAgent.mockResolvedValueOnce(version("h0"));
    const editor = new AgentEditor("scout");
    await editor.load();
    api.deleteAgent.mockRejectedValueOnce(new ApiError(409, "changed"));
    api.getAgent.mockResolvedValueOnce(version("h-disk"));
    expect(await editor.remove()).toBe(false);
    expect(api.deleteAgent).toHaveBeenCalledWith("scout", "h0");
    expect(editor.conflict?.disk?.hash).toBe("h-disk");
  });
});

describe("rules editor", () => {
  it("saves against the loaded hash and resolves a conflict either way", async () => {
    api.getRules.mockResolvedValueOnce({ id: "style", path: "/config/rules/style.md", content: "A", hash: "h0" });
    const editor = new RulesEditor("style");
    await editor.load();
    editor.content = "A\nB";
    expect(editor.dirty).toBe(true);

    api.saveRules.mockRejectedValueOnce(new ApiError(409, "changed"));
    api.getRules.mockResolvedValueOnce({ id: "style", path: "/config/rules/style.md", content: "A\nC", hash: "h-disk" });
    await editor.save();
    expect(api.saveRules).toHaveBeenLastCalledWith("style", { content: "A\nB", baseHash: "h0" });
    expect(editor.conflict?.disk).toEqual({ content: "A\nC", hash: "h-disk" });

    api.saveRules.mockResolvedValueOnce({ id: "style", path: "/config/rules/style.md", hash: "h1" });
    await editor.keepMine();
    expect(api.saveRules).toHaveBeenLastCalledWith("style", { content: "A\nB", baseHash: "h-disk" });
    expect(editor.dirty).toBe(false);
  });

  it("refuses a file name the server wouldn't take before asking it", async () => {
    const editor = new RulesEditor(null);
    editor.id = "Style Guide";
    editor.content = "Rules.";
    expect(await editor.save()).toBe(false);
    expect(api.saveRules).not.toHaveBeenCalled();
    expect(editor.problems[0]).toMatch(/^File name/);
  });
});
