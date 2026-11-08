import { describe, expect, it } from "vitest";
import { isAllowedRequest } from "./origin-guard.js";

describe("isAllowedRequest", () => {
  it.each([
    { method: "GET", origin: "https://evil.example", host: "127.0.0.1:4317", allowed: true },
    { method: "POST", origin: undefined, host: "127.0.0.1:4317", allowed: true },
    { method: "POST", origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317", allowed: true },
    { method: "POST", origin: "https://evil.example", host: "127.0.0.1:4317", allowed: false },
    { method: "DELETE", origin: "http://localhost:4317", host: "127.0.0.1:4317", allowed: false },
    { method: "POST", origin: "null", host: "127.0.0.1:4317", allowed: false },
    { method: "POST", origin: "http://127.0.0.1:4317", host: undefined, allowed: false },
  ])("$method from $origin to $host → $allowed", ({ allowed, ...input }) => {
    expect(isAllowedRequest(input)).toBe(allowed);
  });
});
