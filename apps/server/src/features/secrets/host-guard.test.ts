import { describe, expect, it } from "vitest";
import { isTrustedHost } from "./host-guard.js";

describe("isTrustedHost", () => {
  it.each([
    ["127.0.0.1:4317", true],
    ["localhost:4320", true],
    ["LOCALHOST", true],
    ["[::1]:4317", true],
    ["100.101.102.103:4320", true],
    ["media-server.tail1234.ts.net", true],
    ["media-server.tail1234.ts.net:8443", true],
    ["evil.example.com:4317", false],
    ["localhost.evil.example.com", false],
    ["ts.net.evil.example.com", false],
    ["127.0.0.1.evil.example.com", false],
    ["", false],
    [undefined, false],
    ["a b", false],
  ])("%s", (host, trusted) => {
    expect(isTrustedHost(host)).toBe(trusted);
  });
});
