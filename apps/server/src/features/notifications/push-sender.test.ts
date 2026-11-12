import { describe, expect, it } from "vitest";
import { networkReason } from "./push-sender.js";

describe("networkReason", () => {
  it("follows fetch's cause to the system error", () => {
    const system = Object.assign(new Error("connect EACCES 142.250.70.10:443"), { code: "EACCES" });
    expect(networkReason(new TypeError("fetch failed", { cause: system }))).toBe("fetch failed: connect EACCES 142.250.70.10:443");
  });

  it("adds a code the message leaves out", () => {
    const dns = Object.assign(new Error("getaddrinfo failed"), { code: "ENOTFOUND" });
    expect(networkReason(new TypeError("fetch failed", { cause: dns }))).toBe("fetch failed: getaddrinfo failed (ENOTFOUND)");
  });

  it("says a timeout timed out", () => {
    expect(networkReason(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe("timed out");
  });
});
