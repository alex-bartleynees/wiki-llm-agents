import { describe, expect, it } from "vitest";
import { isSupportedVersion, listeningUrl, printedPassword } from "./server.js";

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
