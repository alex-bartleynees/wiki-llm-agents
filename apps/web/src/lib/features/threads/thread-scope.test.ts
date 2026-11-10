import { describe, expect, it } from "vitest";
import { inScope, projectShownWith, rememberedThreadKey, sameScope } from "./thread-scope.ts";

const vault = { vaultId: "v1", projectId: null };
const project = { vaultId: "v1", projectId: "p1" };

describe("thread scope", () => {
  it("lists all of a vault's threads, or only one project's, never another vault's", () => {
    expect(inScope(vault, { vaultId: "v1", projectId: null })).toBe(true);
    expect(inScope(vault, { vaultId: "v1", projectId: "p1" })).toBe(true);
    expect(inScope(vault, { vaultId: "v2", projectId: null })).toBe(false);
    expect(inScope(project, { vaultId: "v1", projectId: null })).toBe(false);
    expect(inScope(project, { vaultId: "v1", projectId: "p1" })).toBe(true);
    expect(inScope(project, { vaultId: "v1", projectId: "p2" })).toBe(false);
    expect(inScope(project, { vaultId: "v2", projectId: "p1" })).toBe(false);
    expect(inScope(undefined, { vaultId: "v1", projectId: null })).toBe(false);
  });

  it("remembers the open thread per scope, keeping the vault's key from before projects", () => {
    expect(rememberedThreadKey(vault)).toBe("wiki-agents:thread:v1");
    expect(rememberedThreadKey(project)).toBe("wiki-agents:thread:v1:project:p1");
    expect(rememberedThreadKey({ vaultId: "v1", projectId: "p2" })).not.toBe(rememberedThreadKey(project));
  });

  it("compares scopes by vault and project", () => {
    expect(sameScope(vault, { vaultId: "v1", projectId: null })).toBe(true);
    expect(sameScope(vault, project)).toBe(false);
    expect(sameScope(undefined, vault)).toBe(false);
    expect(sameScope(undefined, undefined)).toBe(true);
  });

  it("shows the selected project only with the vault it uses", () => {
    expect(projectShownWith("v1", { id: "p1", vaultId: "v1" })).toBe("p1");
    expect(projectShownWith("v2", { id: "p1", vaultId: "v1" })).toBeNull();
    expect(projectShownWith("v1", null)).toBeNull();
  });
});
