import { describe, expect, it } from "vitest";
import { isCompressibleContentType } from "./compression.js";
import { matchesIfNoneMatch } from "./etag.js";

describe("isCompressibleContentType", () => {
  it("allows text and JSON payloads while excluding SSE and binary formats", () => {
    expect(isCompressibleContentType("application/json; charset=utf-8")).toBe(true);
    expect(isCompressibleContentType("text/html")).toBe(true);
    expect(isCompressibleContentType("text/javascript; charset=utf-8")).toBe(true);
    expect(isCompressibleContentType("application/javascript")).toBe(true);
    expect(isCompressibleContentType("application/wasm")).toBe(true);
    expect(isCompressibleContentType("image/svg+xml")).toBe(true);
    expect(isCompressibleContentType("text/event-stream")).toBe(false);
    expect(isCompressibleContentType("image/png")).toBe(false);
    expect(isCompressibleContentType("application/octet-stream")).toBe(false);
  });
});

describe("matchesIfNoneMatch", () => {
  it("supports weak comparison, lists, and wildcard", () => {
    expect(matchesIfNoneMatch('"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"other", W/"abc"', '"abc"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"xyz"', '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
  });
});
