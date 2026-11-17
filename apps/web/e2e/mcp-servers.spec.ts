import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { e2eRoot } from "./app.ts";

const folder = () => join(e2eRoot(), "config", "mcp");

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

test("adds an MCP server in Settings, edits it, and deletes it to the trash", async ({ page }, info) => {
  const width = info.project.name;
  const id = `github-${width}`;
  await page.goto("/settings");
  await page.getByRole("button", { name: "Add server" }).click();

  const form = page.getByRole("form", { name: "New MCP server" });
  await form.getByLabel("Server name").fill(`GitHub ${width}`);
  await expect(form.getByLabel("Server id")).toHaveValue(id);
  await expect(form).toContainText("An override replaces the agent's autonomy for all of this server's tools");
  await expect(form).toContainText("Threads without a named agent do not receive them.");
  await expect(form).toContainText("Controls how connections are reused.");
  await form.getByLabel("URL").fill("https://api.githubcopilot.com/mcp/");
  // A line that isn't `Name: value` is refused before anything is sent.
  await form.getByLabel("Headers").fill("Authorization Bearer");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("alert")).toHaveText("Line 1 of the headers should read NAME:value.");
  // A reference the app doesn't know is refused by the server, naming the field.
  await form.getByLabel("Headers").fill("Authorization: Bearer ${vault:github}");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("alert")).toContainText("transport.headers.Authorization");
  await form.getByLabel("Headers").fill("Authorization: Bearer ${secret:github}");
  await noOverflow(page);
  await form.getByRole("button", { name: "Add" }).click();

  const list = page.getByRole("list", { name: "MCP servers" });
  const item = list.getByRole("listitem", { name: `GitHub ${width}` });
  await expect(item).toContainText("https://api.githubcopilot.com/mcp/");
  await expect(item).toContainText(`${id} · http · app`);
  await expect(page.getByRole("status").filter({ hasText: `Saved GitHub ${width}.` })).toBeVisible();
  const file = join(folder(), `${id}.yaml`);
  expect(readFileSync(file, "utf8")).toBe(
    `title: GitHub ${width}\ntransport:\n  type: http\n  url: https://api.githubcopilot.com/mcp/\n  headers:\n    Authorization: Bearer \${secret:github}\nscope: app\ndefault: false\n`,
  );

  await expect(item).toContainText("Available only to agents that list this server");

  // Edit: a command instead of a URL, available to every thread.
  await item.getByRole("button", { name: `Edit GitHub ${width}` }).click();
  const editor = page.getByRole("form", { name: `Edit ${id}` });
  await expect(editor.getByLabel("Server id")).toBeDisabled();
  await expect(editor.getByLabel("Headers")).toHaveValue("Authorization: Bearer ${secret:github}");
  await editor.getByLabel("Transport").selectOption("stdio");
  await editor.getByLabel("Command").fill("github-mcp-server");
  await editor.getByLabel("Arguments").fill("stdio\n--read-only");
  await editor.getByLabel("Environment").fill("GITHUB_PERSONAL_ACCESS_TOKEN=${secret:github}");
  await editor.getByLabel("Access", { exact: true }).selectOption("ask");
  await editor.getByLabel("Give its tools to every thread, whatever the agent").check();
  await expect(editor).toContainText("including threads without a named agent");
  await noOverflow(page);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(item).toContainText(`${id} · stdio · app`);
  await expect(item).toContainText("Available to every thread");
  await expect(item).toContainText("github-mcp-server stdio --read-only");
  expect(readFileSync(file, "utf8")).toContain("    GITHUB_PERSONAL_ACCESS_TOKEN: ${secret:github}\n");
  expect(readFileSync(file, "utf8")).toContain("access: ask\n");

  // Changed on disk while the editor is open: saving is refused, nothing is overwritten.
  await item.getByRole("button", { name: `Edit GitHub ${width}` }).click();
  writeFileSync(file, `${readFileSync(file, "utf8")}# edited by hand\n`);
  await editor.getByLabel("Server name").fill("Overwritten");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByRole("alert")).toContainText("has changed since you opened it");
  expect(readFileSync(file, "utf8")).toContain("# edited by hand");
  await editor.getByRole("button", { name: "Cancel" }).click();

  // Delete, after confirming.
  await item.getByRole("button", { name: `Edit GitHub ${width}` }).click();
  await editor.getByRole("button", { name: "Delete" }).click();
  await editor.getByRole("button", { name: `Move ${id} to the trash` }).click();
  await expect(item).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(e2eRoot(), "config", ".trash", "mcp", `${id}.yaml`))).toBe(true);
  await noOverflow(page);
});

test("lists a server file that doesn't load, with the reason", async ({ page }, info) => {
  mkdirSync(folder(), { recursive: true });
  const file = join(folder(), `broken-${info.project.name}.yaml`);
  writeFileSync(file, "transport:\n  type: stdio\n  comand: oops\n");
  await page.goto("/settings");
  const problem = page.getByRole("list", { name: "MCP server files that can't be used" }).getByRole("listitem").filter({ hasText: file });
  await expect(problem).toContainText("transport.comand: Unknown setting; check the spelling.");
  await noOverflow(page);
});
