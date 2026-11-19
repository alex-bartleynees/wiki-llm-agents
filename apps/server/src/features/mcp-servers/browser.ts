import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { McpServerDefinition } from "./definition.js";
import { MCP_EXTENSION } from "./definition.js";

/**
 * The browser for frontend agents: Microsoft's Playwright MCP server, added by the app
 * when `WIKI_AGENTS_BROWSER_MCP` names its program (home-manager `browser.enable`), so no
 * host's path is written into the config folder, which may be shared between machines.
 * A `mcp/playwright.yaml` file replaces it completely.
 *
 * The app, not the install, supplies the settings that keep it contained, so they are
 * the same however the program was installed (Nix, `npm i -g @playwright/mcp`):
 * - headless, with an in-memory profile, and a connection (so a browser) per thread;
 * - run in its own state folder: Playwright lets the browser read and upload only files
 *   under its working folder (the app's MCP client advertises no roots), so neither
 *   the project nor the home folder;
 * - the app's own addresses blocked: the app has no login and trusts requests to
 *   `localhost` or an IP, which a browser on this machine would pass. Playwright's
 *   origin blocking is a guardrail: it doesn't stop a redirect;
 * - no tools that run code outside the page or read files (`excludeTools`);
 * - `access` unset: the read-only tools (screenshots, snapshots, console) follow the
 *   agent's `read`, navigation and clicks its `tools`;
 * - the project's browser sign-ins (`browserSignIns`, see `sign-ins.ts`).
 */
export const BROWSER_SERVER_ID = "playwright";

/**
 * Tools no agent gets from the built-in browser:
 * - `browser_run_code_unsafe` runs Playwright code in the server's own Node process,
 *   outside every provider's sandbox and the protected paths;
 * - `browser_file_upload` gives the page files from disk;
 * - `browser_evaluate` runs script in the page, which can call anything the page can.
 */
export const BROWSER_EXCLUDED_TOOLS: ReadonlyArray<string> = ["browser_run_code_unsafe", "browser_file_upload", "browser_evaluate"];

export interface BrowserSettings {
  /** `WIKI_AGENTS_BROWSER_MCP`: a path, or a name looked up on `PATH`. */
  readonly command: string;
  /** Where the browser runs and writes screenshots: `<data dir>/browser`. */
  readonly stateDir: string;
  /** The app's own origins, blocked in the browser. */
  readonly blockedOrigins: ReadonlyArray<string>;
}

const isWildcard = (host: string) => host === "0.0.0.0" || host === "::" || host === "[::]";

const originOf = (address: string, port: number) => `http://${address.includes(":") && !address.startsWith("[") ? `[${address}]` : address}:${port}`;

/**
 * Every origin the app answers at: loopback by name and address, the configured host,
 * and, when it listens on every interface, each of this machine's addresses.
 */
export const appOrigins = (host: string, port: number, interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): ReadonlyArray<string> => {
  const addresses = new Set(["127.0.0.1", "localhost", "::1"]);
  if (isWildcard(host)) {
    for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) addresses.add(entry.address.split("%")[0] ?? entry.address);
  } else {
    addresses.add(host);
  }
  return [...addresses].map((address) => originOf(address, port));
};

/** The built-in browser server; `folder` is `<config dir>/mcp`, where a file replacing it would go. */
export const browserServer = (settings: BrowserSettings, folder: string): McpServerDefinition => ({
  id: BROWSER_SERVER_ID,
  path: join(folder, `${BROWSER_SERVER_ID}${MCP_EXTENSION}`),
  builtIn: true,
  title: "Browser (Playwright)",
  transport: {
    type: "stdio",
    command: settings.command,
    args: [
      "--headless",
      "--isolated",
      "--output-dir",
      join(settings.stateDir, "output"),
      ...(settings.blockedOrigins.length === 0 ? [] : ["--blocked-origins", settings.blockedOrigins.join(";")]),
    ],
    env: {},
    cwd: settings.stateDir,
  },
  scope: "thread",
  default: false,
  access: null,
  oauth: null,
  excludeTools: BROWSER_EXCLUDED_TOOLS,
  browserSignIns: true,
});
