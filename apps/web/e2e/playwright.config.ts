import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Key flows through the real app: the server from source, serving the built web app,
 * on its own port with a temporary vault, data and config folder (never 4317 or
 * `.data/`). OpenCode is pointed at a missing binary, so turns use the replay
 * provider and cost nothing. Run with `npm run test:e2e -w @wiki-agents/web`.
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
  mkdirSync(join(root, "projects"));
  process.env["E2E_ROOT"] = root;
  process.env["E2E_PORT"] = String(41000 + Math.floor(Math.random() * 2000));
}
const root = process.env["E2E_ROOT"];
const port = Number(process.env["E2E_PORT"]);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: here,
  // One app and one vault: flows run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  globalTeardown: join(here, "teardown.ts"),
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: `node --conditions=source --import tsx src/index.ts --vault ${JSON.stringify(join(root, "vault"))}`,
    cwd: server,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      WIKI_AGENTS_HOST: "127.0.0.1",
      WIKI_AGENTS_PORT: String(port),
      WIKI_AGENTS_DATA_DIR: join(root, "data"),
      WIKI_AGENTS_CONFIG_DIR: join(root, "config"),
      WIKI_AGENTS_STATIC_DIR: join(web, "build"),
      WIKI_AGENTS_OPENCODE: "wiki-agents-e2e-no-opencode",
      WIKI_AGENTS_CLAUDE: "wiki-agents-e2e-no-claude",
      // Lets flows move the schedules' clock instead of waiting (POST /api/test/clock).
      WIKI_AGENTS_TEST_HOOKS: "true",
    },
  },
});
