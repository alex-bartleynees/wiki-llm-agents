import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { describe, expect, it } from "vitest";
import { effectiveAutonomy, inScope, vaultScope, webAllowed } from "./sources.js";

describe("vaultScope", () => {
  it("is the whole vault without sources, or with `vault` among them", () => {
    expect(vaultScope([], "Notes")).toEqual({ _tag: "all" });
    expect(vaultScope(["vault"], "Notes")).toEqual({ _tag: "all" });
    expect(vaultScope(["web", "vault", { vault: "Other", folders: ["A"] }], "Notes")).toEqual({ _tag: "all" });
  });

  it("is nothing when the sources leave this vault out", () => {
    expect(vaultScope(["web"], "Notes")).toEqual({ _tag: "none" });
    expect(vaultScope([{ vault: "Other", folders: [] }], "Notes")).toEqual({ _tag: "none" });
  });

  it("is a named vault's folders, added up over its entries, or all of it when one entry lists none", () => {
    expect(vaultScope([{ vault: "Notes", folders: ["B", "A"] }, { vault: "Notes", folders: ["C"] }], "Notes")).toEqual({ _tag: "folders", folders: ["A", "B", "C"] });
    expect(vaultScope([{ vault: "Notes", folders: ["A"] }, { vault: "Notes", folders: [] }], "Notes")).toEqual({ _tag: "all" });
  });
});

describe("inScope", () => {
  it("takes a folder and everything under it, not a sibling sharing its prefix", () => {
    const scope = { _tag: "folders", folders: ["Projects/Active"] } as const;
    expect(inScope(scope, "Projects/Active")).toBe(true);
    expect(inScope(scope, "Projects/Active/Plan.md")).toBe(true);
    expect(inScope(scope, "Projects/Active Old/Plan.md")).toBe(false);
    expect(inScope(scope, "Projects/Plan.md")).toBe(false);
    expect(inScope({ _tag: "none" }, "Plan.md")).toBe(false);
    expect(inScope({ _tag: "all" }, "Plan.md")).toBe(true);
  });
});

describe("the web", () => {
  it("is a source without sources listed, or when listed; denied otherwise, whatever the file's autonomy", () => {
    const autonomy = { ...DEFAULT_AUTONOMY, web: "allow" } as const;
    expect(webAllowed([])).toBe(true);
    expect(effectiveAutonomy({ autonomy, sources: ["vault", "web"] }).web).toBe("allow");
    expect(effectiveAutonomy({ autonomy, sources: ["vault"] })).toEqual({ ...autonomy, web: "deny" });
  });
});
