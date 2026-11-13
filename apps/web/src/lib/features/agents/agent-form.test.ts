import { describe, expect, it } from "vitest";
import { BLANK_AGENT, changedFields, describeSources, idFromName, problemsByField } from "./agent-form.ts";

describe("agent form", () => {
  it("makes a file name from the agent's name", () => {
    expect(idFromName("Code Reviewer")).toBe("code-reviewer");
    expect(idFromName("  Café — notes! ")).toBe("cafe-notes");
  });

  it("files the server's problems under their fields", () => {
    expect(problemsByField("name: Give the agent a name.\nsources.0.folders.0: A folder inside the vault.\nSomething else.\nzzz: odd")).toEqual({
      name: ["Give the agent a name."],
      sources: ["A folder inside the vault."],
      form: ["Something else.", "zzz: odd"],
    });
  });

  it("lists the fields two versions differ in", () => {
    expect(changedFields(BLANK_AGENT, { ...BLANK_AGENT, name: "x", autonomy: { ...BLANK_AGENT.autonomy, web: "deny" } })).toEqual(["name", "autonomy"]);
  });

  it("describes sources", () => {
    expect(describeSources([])).toBe("Any vault and the web (no limits)");
    expect(describeSources(["vault", { vault: "Notes", folders: ["A", "B"] }, "web"])).toBe("The thread's vault · Notes: A, B · The web");
  });
});
