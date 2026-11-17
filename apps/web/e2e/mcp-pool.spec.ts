import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const STAND_IN = fileURLToPath(new URL("./stand-in-mcp-stdio.mjs", import.meta.url));

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

const addStdioServer = async (page: Page, title: string, command: string, args: string) => {
  await page.getByRole("button", { name: "Add server" }).click();
  const form = page.getByRole("form", { name: "New MCP server" });
  await form.getByLabel("Server name").fill(title);
  await form.getByLabel("Transport").selectOption("stdio");
  await form.getByLabel("Command").fill(command);
  await form.getByLabel("Arguments").fill(args);
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form).toHaveCount(0);
  return page.getByRole("list", { name: "MCP servers" }).getByRole("listitem", { name: title });
};

test("tests an MCP server and lists its tools, restarts it, and says why one can't connect", async ({ page }, info) => {
  const width = info.project.name;
  const title = `Beans ${width}`;
  await page.goto("/settings");

  const item = await addStdioServer(page, title, process.execPath, STAND_IN);
  await expect(item).toContainText("Not connected yet; Test lists its tools");

  await item.getByRole("button", { name: `Test ${title}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${title} answered.` })).toBeVisible();
  await expect(item).toContainText("Not connected now · 2 tools when last listed");
  const tools = item.getByRole("list", { name: `Tools of ${title}` });
  await expect(tools.getByRole("listitem")).toHaveText([
    `beans-${width}__search_beans · read-only Finds beans by name.`,
    `beans-${width}__log_brew Adds a brew to the journal.`,
  ]);
  await noOverflow(page);
  await item.getByRole("button", { name: "Hide tools" }).click();
  await expect(tools).toHaveCount(0);

  // A server nothing has connected to has nothing to restart.
  await expect(item.getByRole("button", { name: `Restart ${title}` })).toHaveCount(0);

  const broken = `Broken ${width}`;
  const brokenItem = await addStdioServer(page, broken, "wiki-agents-no-such-command", "");
  await brokenItem.getByRole("button", { name: `Test ${broken}` }).click();
  await expect(brokenItem).toContainText("Can't connect");
  await expect(brokenItem).toContainText("Cannot spawn MCP server");
  await noOverflow(page);

  // Restart forgets the failure and, for a shared server, connects again at once (and fails again here).
  await brokenItem.getByRole("button", { name: `Restart ${broken}` }).click();
  await expect(brokenItem).toContainText("Can't connect; waiting before trying again (Restart tries now)");

  // Shown again after a reload, from the server's memory.
  await page.reload();
  await expect(item).toContainText("2 tools when last listed");
  await expect(brokenItem).toContainText("Cannot spawn MCP server");
});
