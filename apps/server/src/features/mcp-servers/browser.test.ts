import { describe, expect, it } from "vitest";
import { appOrigins, browserServer } from "./browser.js";
import { withBuiltIns } from "./catalog-live.js";

const interfaces = {
  lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: null }],
  eth0: [
    { address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: null },
    { address: "fe80::1%eth0", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "", internal: false, cidr: null, scopeid: 2 },
  ],
} as unknown as Parameters<typeof appOrigins>[2];

describe("appOrigins", () => {
  it("is loopback and the configured host", () => {
    expect(appOrigins("127.0.0.1", 4317, interfaces)).toEqual(["http://127.0.0.1:4317", "http://localhost:4317", "http://[::1]:4317"]);
    expect(appOrigins("10.0.0.2", 4320, interfaces)).toEqual(["http://127.0.0.1:4320", "http://localhost:4320", "http://[::1]:4320", "http://10.0.0.2:4320"]);
  });

  it("adds every address of this machine when the app listens on all of them", () => {
    expect(appOrigins("0.0.0.0", 4317, interfaces)).toEqual([
      "http://127.0.0.1:4317",
      "http://localhost:4317",
      "http://[::1]:4317",
      "http://192.168.1.20:4317",
      "http://[fe80::1]:4317",
    ]);
  });
});

describe("withBuiltIns", () => {
  const browser = browserServer({ command: "playwright-mcp", stateDir: "/data/browser", blockedOrigins: [] }, "/config/mcp");
  const empty = { folder: "/config/mcp", servers: [], problems: [] };

  it("adds the built-in servers, without blocked origins when there are none", () => {
    expect(withBuiltIns(empty, [browser]).servers).toEqual([browser]);
    expect(browser.transport.type === "stdio" && browser.transport.args).toEqual(["--headless", "--isolated", "--output-dir", "/data/browser/output"]);
  });

  it("leaves one out when a file has its id, even a file that doesn't load", () => {
    const file = { ...browser, builtIn: false, title: "Mine" };
    expect(withBuiltIns({ ...empty, servers: [file] }, [browser]).servers).toEqual([file]);
    const broken = { ...empty, problems: [{ path: "/config/mcp/playwright.yaml", message: "Not valid YAML." }] };
    expect(withBuiltIns(broken, [browser]).servers).toEqual([]);
  });
});
