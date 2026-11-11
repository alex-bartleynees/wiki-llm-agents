import { describe, expect, it } from "vitest";
import { chatModels, isSupportedVersion, listeningUrl, printedPassword, type ListedModel } from "./server.js";

describe("listeningUrl", () => {
  it.each([
    ["server listening on http://127.0.0.1:41234", "http://127.0.0.1:41234"],
    ["Server listening on http://127.0.0.1:35673  ", "http://127.0.0.1:35673"],
    // Anything else that mentions a URL is not OpenCode saying where it listens.
    ["Debugger listening on ws://127.0.0.1:9229/abc", undefined],
    ["[plugin] MCP bridge listening on http://127.0.0.1:4317", undefined],
    ["server listening on http://0.0.0.0:41234", undefined],
    ["server password abc", undefined],
  ])("%s", (line, url) => {
    expect(listeningUrl(line)).toBe(url);
  });
});

describe("isSupportedVersion", () => {
  it.each([
    ["2.2.1", true],
    ["v2.2.5", true],
    ["2.3.0", false],
    ["1.19.5", false],
  ])("%s", (version, supported) => {
    expect(isSupportedVersion(version)).toBe(supported);
  });
});

describe("printedPassword", () => {
  it.each([
    ["server password Omqs6YL6irmmdr7oGk3m", "Omqs6YL6irmmdr7oGk3m"],
    ["server listening on http://127.0.0.1:35921", undefined],
    ["the server password is wrong", undefined],
  ])("%s", (line, password) => {
    expect(printedPassword(line)).toBe(password);
  });
});

describe("chatModels", () => {
  const model = (id: string, extra: Partial<ListedModel> = {}): ListedModel => ({
    id,
    providerID: "github-copilot",
    name: id,
    status: "active",
    enabled: true,
    cost: [{ input: 1, output: 4 }],
    ...extra,
  });

  it("keeps models without a type, as GitHub Copilot's account models have none", () => {
    expect(chatModels([model("claude-sonnet-5.5"), model("gpt-6-sol", { type: "chat" })]).map((m) => m.id)).toEqual([
      "github-copilot/claude-sonnet-5.5",
      "github-copilot/gpt-6-sol",
    ]);
  });

  it("leaves out other types, disabled and deprecated models, and marks free ones", () => {
    const listed = chatModels([
      model("image", { type: "image" }),
      model("off", { enabled: false }),
      model("old", { status: "deprecated" }),
      model("big-pickle", { providerID: "opencode", cost: [{ input: 0, output: 0 }] }),
    ]);
    expect(listed).toEqual([{ id: "opencode/big-pickle", name: "big-pickle", free: true }]);
  });
});
