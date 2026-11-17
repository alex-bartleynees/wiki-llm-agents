import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { describe, expect, it } from "vitest";
import { BLANK_FORM, formFromServer, idFromTitle, inputFromForm, isValidId } from "./server-form.ts";

const HTTP: McpServerInput = {
  title: "GitHub",
  transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${secret:github}", "X-Mode": "read: only" } },
  scope: "app",
  default: false,
  access: null,
  oauth: null,
};

const COFFEE: McpServerInput = {
  title: "Coffee journal",
  transport: { type: "http", url: "https://app.coffeesjournal.com/mcp", headers: {} },
  scope: "app",
  default: false,
  access: null,
  oauth: { clientId: "coffee-journal-ai-agent", scopes: ["coffee-journal:read"] },
};

const STDIO: McpServerInput = {
  title: "Browser",
  transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"], env: { TOKEN: "${env:BROWSER_TOKEN}", URL: "a=b" }, cwd: "/srv/browser" },
  scope: "thread",
  default: true,
  access: "ask",
  oauth: null,
};

describe("the server form", () => {
  it.each([
    ["an http server", HTTP],
    ["a stdio server", STDIO],
    ["a server that signs in", COFFEE],
  ])("saves %s as it was loaded", (_what, server) => {
    expect(inputFromForm(formFromServer(server))).toEqual({ input: server });
  });

  it("shows pairs one per line", () => {
    expect(formFromServer(HTTP).headers).toBe("Authorization: Bearer ${secret:github}\nX-Mode: read: only");
    expect(formFromServer(STDIO)).toMatchObject({ args: "-y\n@playwright/mcp", env: "TOKEN=${env:BROWSER_TOKEN}\nURL=a=b" });
  });

  it("trims what was typed and skips blank lines", () => {
    const form = { ...BLANK_FORM, type: "stdio" as const, title: " Notes ", command: " notes-mcp ", args: "\n serve \n\n", env: "\nA = 1\n", cwd: "  " };
    expect(inputFromForm(form)).toEqual({
      input: { title: "Notes", transport: { type: "stdio", command: "notes-mcp", args: ["serve"], env: { A: "1" }, cwd: null }, scope: "app", default: false, access: null, oauth: null },
    });
  });

  it("reads sign-in scopes separated by spaces or lines, and leaves sign-in out when both fields are empty", () => {
    const form = { ...BLANK_FORM, url: "https://mcp.example.com", clientId: " ", scopes: " read\nwrite  offline_access " };
    expect(inputFromForm(form)).toMatchObject({ input: { oauth: { clientId: null, scopes: ["read", "write", "offline_access"] } } });
    expect(inputFromForm({ ...form, scopes: "" })).toMatchObject({ input: { oauth: null } });
    expect(formFromServer(COFFEE)).toMatchObject({ clientId: "coffee-journal-ai-agent", scopes: "coffee-journal:read" });
  });

  it("says which line isn't a pair", () => {
    expect(inputFromForm({ ...BLANK_FORM, headers: "Authorization: x\nno separator here" })).toEqual({ problems: ["Line 2 of the headers should read NAME:value."] });
    expect(inputFromForm({ ...BLANK_FORM, type: "stdio", env: "=value" })).toEqual({ problems: ["Line 1 of the environment should read NAME=value."] });
  });

  it("makes an id from a title", () => {
    expect(idFromTitle("My Browser (Café)")).toBe("my-browser-cafe");
    expect(isValidId(idFromTitle("GitHub"))).toBe(true);
    expect(isValidId("")).toBe(false);
    expect(isValidId("-x")).toBe(false);
  });
});
