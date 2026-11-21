import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Key flows through the real app: the server from source, serving the built web app,
 * on its own port with a temporary vault, data and config folder (never 4317 or
 * `.data/`). OpenCode, Claude Code and Codex point at missing binaries, and test hooks
 * add the replay provider (test-only), so turns cost nothing. Run with
 * `npm run test:e2e -w @wiki-agents/web`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const server = join(web, "..", "server");

// Nix provides the browsers; they only work with the matching Playwright.
const installed = (createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }).version;
const driver = process.env["PLAYWRIGHT_DRIVER_VERSION"];
if (driver !== undefined && driver !== installed) {
  throw new Error(`@playwright/test ${installed} doesn't match Nix's playwright-driver ${driver}; pin @playwright/test and playwright to ${driver}.`);
}

/** Notes every flow can rely on. */
const VAULT: Readonly<Record<string, string>> = {
  "index.md": "# Home\n\nStart with [[Coffee]].\n",
  "Diagrams.md": "# Diagrams\n\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n\n```mermaid\ninvalid diagram\n```\n\n```js\nconst ordinary = true;\n```\n",
  "Coffee.md": "# Coffee\n\nFlat whites in the morning. See [[Tea]].\n",
  "Tea.md": "# Tea\n\nGreen tea in the afternoon.\n",
  "Notes/Brewing.md": "# Brewing\n\nPour-over with a V60.\n",
  // The replay agent's edit (any message with "edit") appends a line here.
  "Replay note.md": "# Replay note\n\nLines the replay agent added:\n\n",
};

// The main process sets up one app per run; workers inherit these variables.
if (process.env["E2E_ROOT"] === undefined) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-e2e-")));
  for (const [path, text] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(root, "vault", path)), { recursive: true });
    writeFileSync(join(root, "vault", path), text);
  }
  for (const scenario of ["inactivity-desktop", "inactivity-phone"]) {
    const vault = join(root, scenario, "vault");
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, "index.md"), VAULT["index.md"]!);
  }
  mkdirSync(join(root, "projects"));
  // A secret declared in the service's configuration, as sops-nix would provide it.
  mkdirSync(join(root, "run-secrets"));
  writeFileSync(join(root, "run-secrets", "jira"), "jira-token\n");
  process.env["E2E_ROOT"] = root;
  process.env["E2E_PORT"] = String(41000 + Math.floor(Math.random() * 2000));
}
const root = process.env["E2E_ROOT"];
const port = Number(process.env["E2E_PORT"]);
const baseURL = (port: number) => `http://127.0.0.1:${port}`;
const inactivityTest = "**/thread-inactivity.spec.ts";
const desktop = { browserName: "chromium", viewport: { width: 1440, height: 900 } } as const;
const phone = { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;
const inactivityDesktopPort = port + 2000;
const inactivityPhonePort = port + 4000;

const webServer = (instanceRoot: string, port: number) => ({
  command: `node --conditions=source --import tsx src/index.ts --vault ${JSON.stringify(join(instanceRoot, "vault"))}`,
  cwd: server,
  url: `${baseURL(port)}/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    WIKI_AGENTS_HOST: "127.0.0.1",
    WIKI_AGENTS_PORT: String(port),
    WIKI_AGENTS_DATA_DIR: join(instanceRoot, "data"),
    WIKI_AGENTS_CONFIG_DIR: join(instanceRoot, "config"),
    WIKI_AGENTS_STATIC_DIR: join(web, "build"),
    // This checkout's migrations, not those of an installed copy whose settings the shell may carry.
    WIKI_AGENTS_MIGRATIONS_DIR: join(server, "drizzle"),
    // Stored secrets' key in the run's folder, never systemd's or your own.
    WIKI_AGENTS_SECRETS_KEY: "file",
    WIKI_AGENTS_SECRETS_KEY_FILE: join(instanceRoot, "state", "secrets.key"),
    WIKI_AGENTS_SECRET_FILES: `jira=${join(root, "run-secrets", "jira")}`,
    WIKI_AGENTS_OPENCODE: "wiki-agents-e2e-no-opencode",
    WIKI_AGENTS_CLAUDE: "wiki-agents-e2e-no-claude",
    WIKI_AGENTS_CODEX: "wiki-agents-e2e-no-codex",
    // Adds the built-in browser server to Settings; nothing starts it in the flows.
    WIKI_AGENTS_BROWSER_MCP: "wiki-agents-e2e-no-browser",
    // Lets flows move the schedules' clock instead of waiting (POST /api/test/clock),
    // and adds the replay provider, which exists for tests only.
    WIKI_AGENTS_TEST_HOOKS: "true",
  },
});

export default defineConfig({
  testDir: here,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  globalTeardown: join(here, "teardown.ts"),
  use: { baseURL: baseURL(port), trace: "retain-on-failure" },
  projects: [
    { name: "desktop", testIgnore: inactivityTest, use: desktop },
    { name: "phone", testIgnore: inactivityTest, use: phone },
    { name: "inactivity-desktop", testMatch: inactivityTest, use: { ...desktop, baseURL: baseURL(inactivityDesktopPort) } },
    { name: "inactivity-phone", testMatch: inactivityTest, use: { ...phone, baseURL: baseURL(inactivityPhonePort) } },
  ],
  webServer: [
    webServer(root, port),
    webServer(join(root, "inactivity-desktop"), inactivityDesktopPort),
    webServer(join(root, "inactivity-phone"), inactivityPhonePort),
  ],
});
