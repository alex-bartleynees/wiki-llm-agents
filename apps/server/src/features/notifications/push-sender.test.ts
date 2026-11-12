import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { fetchHeaders, networkReason } from "./push-sender.js";

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

describe("fetchHeaders", () => {
  it("sends a web-push request through fetch once undici 8 is loaded", async () => {
    // Loading it makes undici 8 handle Node's own fetch, as it does in the app.
    await import("@effect/platform-node/Undici");
    const received: Array<{ length: string | undefined; bytes: number; ttl: string | undefined }> = [];
    const server = createServer((request, response) => {
      const chunks: Array<Buffer> = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ length: request.headers["content-length"], bytes: Buffer.concat(chunks).length, ttl: request.headers["ttl"] as string | undefined });
        response.writeHead(201).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      const subscription = {
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`,
        keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
      };
      const details = webpush.generateRequestDetails(subscription, "hello", {
        vapidDetails: { subject: "https://example.test", ...webpush.generateVAPIDKeys() },
        TTL: 60,
        contentEncoding: "aes128gcm",
      });
      const response = await fetch(details.endpoint, { method: details.method, headers: fetchHeaders(details.headers), body: details.body });
      expect(response.status).toBe(201);
      expect(received).toEqual([{ length: String(details.body!.length), bytes: details.body!.length, ttl: "60" }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
